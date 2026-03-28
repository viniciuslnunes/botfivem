

const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const config = require('./config');
const utils = require('./utils/formatarNick');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// Carregar comandos
client.commands = new Map();
const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
  }
}

// Carregar handlers de eventos
const eventFiles = fs.readdirSync(path.join(__dirname, 'events')).filter(file => file.endsWith('.js'));
for (const file of eventFiles) {
  const eventHandler = require(`./events/${file}`);
  // Alguns handlers recebem só client, outros recebem client+config+utils
  if (eventHandler.length === 1) {
    eventHandler(client);
  } else {
    eventHandler(client, config, utils);
  }
}

client.login(process.env.BOT_TOKEN);
