const { REST, Routes } = require('discord.js');
const fs = require('fs');
require('dotenv').config();

const commands = [];
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  commands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

(async () => {
  try {
    console.log('Iniciando deploy dos comandos slash...');
    // Registrar comandos apenas para a guild (atualização instantânea)
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, '1198743169030951004'),
      { body: commands },
    );
    console.log('Comandos registrados com sucesso na guild 1198743169030951004!');
  } catch (error) {
    console.error(error);
  }
})();
