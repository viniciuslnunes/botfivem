const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { atualizarHierarquia } = require('../utils/hierarquiaEmbed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hierarquia')
    .setDescription('Atualiza e exibe a hierarquia completa no canal fixo')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });
    await atualizarHierarquia(interaction.client);
    await interaction.editReply({ content: '🦅 HIERARQUIA ATUALIZADA NO CANAL.' });
  },
};
