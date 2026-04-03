const { SlashCommandBuilder } = require('discord.js');
const { atualizarMural } = require('../utils/muralAssociados');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mural')
    .setDescription('Atualiza o mural de associados no canal dedicado'),
  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    try {
      await atualizarMural(interaction.client);
      await interaction.editReply({ content: '🦅 Mural de associados atualizado!' });
    } catch (err) {
      console.error('[mural] Erro ao atualizar mural:', err);
      await interaction.editReply({ content: '❌ Erro ao atualizar o mural. Tente novamente.' });
    }
  }
};
