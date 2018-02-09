var restify = require('restify');
var builder = require('botbuilder');
var azure = require('azure-storage');
var botbuilder_azure = require("botbuilder-azure");
var fetch = require('node-fetch');
var dbURI = process.env.documentDBURI;
var dbKey = process.env.documentDBMasterKey;

var documentDbOptions = {
    host: dbURI,
    masterKey: dbKey,
    database: 'botdocs',
    collection: 'botdata'
};

var docDbClient = new botbuilder_azure.DocumentDbClient(documentDbOptions);
var cosmosStorage = new botbuilder_azure.AzureBotStorage({ gzipData: false }, docDbClient);

// Setup Restify Server
var server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function () {
    console.log('%s listening to %s', server.name, server.url);
});

// Create chat connector for communicating with the Bot Framework Service
var connector = new builder.ChatConnector({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword,
    openIdMetadata: process.env.BotOpenIdMetadata
});

// Listen for messages from users 
server.post('/api/messages', connector.listen());

// We're running CosmosDB DocumentDbClient here, so no azure tables. 
// Leaving for posterity
var tableName = 'botdata';
var azureTableClient = new botbuilder_azure.AzureTableClient(tableName, process.env['AzureWebJobsStorage']);
var tableStorage = new botbuilder_azure.AzureBotStorage({ gzipData: false }, azureTableClient);

// we don't need to store all conversations in cosmosdb - OR DO WE??
var inMemoryStorage = new builder.MemoryBotStorage();

// BOT INITIALIZATION
var bot = new builder.UniversalBot(connector);
bot.set('storage', inMemoryStorage);

//LUIS SETUP
var luisAppId = process.env.LuisAppId;
var luisAPIKey = process.env.LuisAPIKey;
var luisAPIHostName = process.env.LuisAPIHostName || 'westus.api.cognitive.microsoft.com';
const LuisModelUrl = 'https://' + luisAPIHostName + '/luis/v1/application?id=' + luisAppId + '&subscription-key=' + luisAPIKey;

// CALLBACK FROM TRIGGERS
bot.on('trigger', function (message) {
    // handle message from trigger function
    var queuedMessage = message.value;
    var reply = new builder.Message()
        .address(queuedMessage.address)
        //    .text(queuedMessage.text);
        .text('This is coming from the trigger: ' + queuedMessage.text);
    bot.send(reply);
});


// START WAR DIALOG
bot.dialog('war', (session) => {
    session.send("War, my liege?");
    session.beginDialog('startWar');
}).triggerAction({ matches: /war$/i, });

// Prompt for a house to start war with
bot.dialog('startWar', [
    function (session) {
        session.send("Very well...")
        builder.Prompts.text(session, "Upon whom shall we declare war, my lord?");
    },
    function (session, results) {
        session.dialogData.houseToWageWarWith = results.response;
        builder.Prompts.number(session, "And how many soldiers shall I conscript for this war?");
    },
    function (session, results) {
        session.dialogData.soldiersInWar = results.response;
        builder.Prompts.number(session, "Very well. Any dragons?");
    },
    function (session, results) {
        session.dialogData.dragonsInWar = results.response;
        session.send("Excellent, my Lord.");
        session.send(`We will be declaring war upon house ${session.dialogData.houseToWageWarWith}, using ${session.dialogData.soldiersInWar} soldiers and ${session.dialogData.dragonsInWar} dragons.`)
        session.send("I will send a raven immediately, to provision a war room for the forthcoming battle");
        var flowUrl = "https://prod-53.westeurope.logic.azure.com:443/workflows/fab679e858a6476d91fc4fc048c98d61/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=jU2sWL379pWniGLgckcqsNLxVSfXi236zfltjJVyNbk"
        var postBody = {
            "Name": `The war against House ${session.dialogData.houseToWageWarWith}`,
            "Description": `We will slay the ${session.dialogData.houseToWageWarWith}s, with ${session.dialogData.soldiersInWar} and ${session.dialogData.dragonsInWar}`,
            "Responsible": "i:0#.f|membership|tarald@acdc1806.onmicrosoft.com",
            "Public": "True",
            "HouseName": "Cloudborne"
        };
        var SiteTitle = `The war against House ${session.dialogData.houseToWageWarWith}`;
        var SiteUrl = SiteTitle.replace(/\s/g, "").toLowerCase();
        var fullSiteUrl = `https://acdc1806.sharepoint.com/sites/${SiteUrl}`
        fetch(flowUrl, {
            method: "POST",
            body: JSON.stringify(postBody),
            headers: { "content-type": "application/json" },
        }).then(res => { session.send(`Raven away, my Liege! - your war room awaits you at ${fullSiteUrl}`) })
        session.endDialogWithResult(results);
    }
])

// LUIS RECOGNIZER
var recognizer = new builder.LuisRecognizer(LuisModelUrl);

var intents = new builder.IntentDialog({ recognizers: [recognizer] })
    .matches('Greeting', (session) => {
        var nowHours = new Date().getHours();
        var timeOfDay = "day"
        if (nowHours >= 0 && nowHours < 5) { timeOfDay = "night" } else
            if (nowHours > 5 && nowHours < 10) { timeOfDay = "morning" } else
                if (nowHours > 13 && nowHours < 17) { timeOfDay = "afternoon" } else
                    if (nowHours > 17 && nowHours < 23) { timeOfDay = "evening" }
        session.send(`Good ${timeOfDay}, my Liege!`);
    })
    .matches('GoToWar', (session) => { session.send("War, my liege?"); session.beginDialog('startWar'); })
    .matches('Help', (session) => { session.send("How may I help you, my liege?") })
    .matches('Goodbye', (session) => { session.send("Farewell, my Liege") })
    .matches('Cancel', (session) => { session.send('Sorry, Liege, what do you mean by \'%s\'.', session.message.text) })
    .matches('ThrowDice', (session) => {
        var queuedMessage = { address: session.message.address, text: session.message.text };
        session.sendTyping();
        var queueSvc = azure.createQueueService(process.env.AzureWebJobsStorage);
        queueSvc.createQueueIfNotExists('dice-throw', function (err, result, response) {
            if (!err) {
                var queueMessageBuffer = new Buffer(JSON.stringify(queuedMessage)).toString('base64');
                queueSvc.createMessage('dice-throw', queueMessageBuffer, function (err, result, response) {
                    if (!err) { session.send('Throwing a dice, my liege!'); }
                    else { session.send('There was an error inserting your message into queue'); }
                });
            } else { session.send('There was an error creating your queue'); }
        });
    })
    .onDefault((session) => {
        session.send("Forgive me, my liege, I did not understand...");
    });

bot.dialog('/', intents);    
