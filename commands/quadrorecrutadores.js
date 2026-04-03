const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { atualizarQuadroRecrutadores } = require('../utils/quadroRecrutadores');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quadrorecrutadores')
    .setDescription('Atualiza o quadro de recrutadores no canal fixo')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });
    await atualizarQuadroRecrutadores(interaction.client);
    await interaction.editReply({ content: '🦅 QUADRO DE RECRUTADORES ATUALIZADO NO CANAL.' });
  },
};
