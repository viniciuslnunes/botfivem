const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { executar } = require('../utils/setup/comando');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Onboarding da torcida: diagnosticar, mapear e criar cargos e canais (administrador)')
    .addSubcommand(s => s.setName('diagnostico').setDescription('Confere permissões do bot, IDs do tenant e canais de log neste servidor'))
    .addSubcommand(s => s.setName('mapear').setDescription('Procura pelo nome o que o servidor já tem para cada cargo e canal necessário'))
    .addSubcommand(s => s.setName('criar').setDescription('Cria os cargos e canais que faltam para os módulos ligados'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  execute: executar,
};
