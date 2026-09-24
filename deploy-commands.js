const { REST, Routes } = require('discord.js');
require('dotenv').config();

const faltando = ['DISCORD_TOKEN', 'CLIENT_ID'].filter(nome => !process.env[nome]);
if (faltando.length) {
  console.error(`Faltam variáveis de ambiente: ${faltando.join(', ')}.`);
  console.error('Crie o arquivo .env a partir do .env.example, ou rode com as variáveis do Railway: railway run npm run deploy');
  process.exit(1);
}

// Registra só os comandos dos módulos LIGADOS no tenant (TENANT, default
// "gavioes"): torcida sem rifas não vê /rifa no servidor. Em modo instalação
// (tenant.instalacao) só o /setup.
const plataforma = require('./plataforma');
const { guildId } = require('./config/index.js');

const cliente = { commands: null };
plataforma.carregarModulos(cliente);
const commands = [...cliente.commands.values()].map(c => c.data.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Iniciando deploy de ${commands.length} comando(s) slash (${plataforma.ativos.length} módulos ligados)...`);
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
