var restify = require('restify');
var builder = require('botbuilder');
var azure = require('botbuilder-azure');
require('dotenv').config();
var dbURI = process.env.documentDBURI
var dbKey = process.env.documentDBMasterKey

var documentDbOptions = {
    host: dbURI,
    masterKey: dbKey,
    database: 'botdocs',
    collection: 'botdata'
};

var docDbClient = new azure.DocumentDbClient(documentDbOptions);
var cosmosStorage = new azure.AzureBotStorage({ gzipData: false }, docDbClient);

// Setup Restify Server
var server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function () {
    console.log('%s listening to %s', server.name, server.url);
});

// Create chat connector for communicating with the Bot Framework Service
var connector = new builder.ChatConnector({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword
});

// Listen for messages from users 
server.post('/api/messages', connector.listen());

// Receive messages from the user and respond by echoing each message back (prefixed with 'You said:')
var bot = new builder.UniversalBot(connector, function (session) {
    session.send("You said: %s", session.message.text);
}).set('storage', cosmosStorage);