

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const faltando = ['DISCORD_TOKEN', 'DATABASE_URL'].filter(nome => !process.env[nome]);
if (faltando.length) {
  console.error(`Faltam variáveis de ambiente: ${faltando.join(', ')}. Veja o .env.example.`);
  process.exit(1);
}

// Caminho explícito: sem o "/index.js", require('./config') pegaria o
// config.js legado da raiz (removido) em vez do diretório config/.
const config = require('./config/index.js');
const utils = require('./utils/formatarNick');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

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

client.login(process.env.DISCORD_TOKEN);
