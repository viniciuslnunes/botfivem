const { REST, Routes } = require('discord.js');
const fs = require('fs');
require('dotenv').config();
const { guildId } = require('./config/index.js');

const faltando = ['DISCORD_TOKEN', 'CLIENT_ID'].filter(nome => !process.env[nome]);
if (faltando.length) {
  console.error(`Faltam variáveis de ambiente: ${faltando.join(', ')}.`);
  console.error('Crie o arquivo .env a partir do .env.example, ou rode com as variáveis do Railway: railway run npm run deploy');
  process.exit(1);
}

const commands = [];
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  commands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Iniciando deploy dos comandos slash...');
    // Registrar comandos apenas para a guild (atualização instantânea)
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
      { body: commands },
    );
    console.log(`Comandos registrados com sucesso na guild ${guildId}!`);
  } catch (error) {
    console.error(error);
  }
})();
