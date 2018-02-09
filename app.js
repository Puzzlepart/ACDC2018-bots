var restify = require('restify');
var builder = require('botbuilder');
var azure = require('azure-storage');
var botbuilder_azure = require("botbuilder-azure");
var dbURI = process.env.documentDBURI
var dbKey = process.env.documentDBMasterKey

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

// we don't need to store all conversations in cosmosdb
var inMemoryStorage = new builder.MemoryBotStorage();

// Create your bot with a function to receive messages from the user
var bot = new builder.UniversalBot(connector);
bot.set('storage', inMemoryStorage);

//LUIS SETUP
// Make sure you add code to validate these fields
var luisAppId = process.env.LuisAppId;
var luisAPIKey = process.env.LuisAPIKey;
var luisAPIHostName = process.env.LuisAPIHostName || 'westus.api.cognitive.microsoft.com';

const LuisModelUrl = 'https://' + luisAPIHostName + '/luis/v1/application?id=' + luisAppId + '&subscription-key=' + luisAPIKey;

// CALLBACK FROM TRIGGERS
// Intercept trigger event (ActivityTypes.Trigger)
bot.on('trigger', function (message) {
    // handle message from trigger function
    var queuedMessage = message.value;
    var reply = new builder.Message()
        .address(queuedMessage.address)
        .text(queuedMessage.text);
    // .text('This is coming from the trigger: ' + queuedMessage.text);
    bot.send(reply);
});


bot.dialog('/', function (session) {
    session.send("Yes, my liege?")
})




// START WAR DIALOG
bot.dialog('war', function (session, args, next) {
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
        session.send("I will send a raven immediately, to provision a war room for the forthcoming battle")
        // TODO:
        // SEND session.dialogData to flow azure function
        session.endDialogWithResult(results);
    }
])


// DICE POC
bot.dialog('dice', function (session, args, next) {
    var queuedMessage = { address: session.message.address, text: session.message.text };
    // add message to queue
    session.sendTyping();
    var queueSvc = azure.createQueueService(process.env.AzureWebJobsStorage);
    queueSvc.createQueueIfNotExists('dice-throw', function (err, result, response) {
        if (!err) {
            // Add the message to the queue
            var queueMessageBuffer = new Buffer(JSON.stringify(queuedMessage)).toString('base64');
            queueSvc.createMessage('dice-throw', queueMessageBuffer, function (err, result, response) {
                if (!err) {
                    session.send('Throwing a dice, my liege!');
                } else { session.send('There was an error inserting your message into queue'); }
            });
        } else { session.send('There was an error creating your queue'); }
    });
}).triggerAction({ matches: /^dice$/i, });


// LUIS DIALOG
var recognizer = new builder.LuisRecognizer(LuisModelUrl);
var intents = new builder.IntentDialog({ recognizers: [recognizer] })
    .matches('Greeting', (session) => {
        session.send('You reached Greeting intent, you said \'%s\'.', session.message.text);
    })
    .matches('Help', (session) => {
        session.send('You reached Help intent, you said \'%s\'.', session.message.text);
    })
    .matches('Cancel', (session) => {
        session.send('You reached Cancel intent, you said \'%s\'.', session.message.text);
    })
    /*
    .matches('<yourIntent>')... See details at http://docs.botframework.com/builder/node/guides/understanding-natural-language/
    */
    .onDefault((session) => {
        session.send('Sorry, I did not understand \'%s\'.', session.message.text);
    });

bot.dialog('/', intents);    
