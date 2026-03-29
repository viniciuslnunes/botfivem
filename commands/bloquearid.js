const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bloquearid')
    .setDescription('Adiciona um novo ID à lista de não recrutar'),
  async execute(interaction) {
    // Só permitir no canal correto
    if (interaction.channelId !== '1487943419203551313') {
      return interaction.reply({ content: 'Use este comando apenas no canal ❌・nao-recrutar.', flags: 64 });
    }
    const modal = new ModalBuilder()
      .setCustomId('modal_bloquearid')
      .setTitle('Bloquear novo ID');
    const idInput = new TextInputBuilder()
      .setCustomId('id')
      .setLabel('ID FiveM')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(3)
      .setMaxLength(6);
    const motivoInput = new TextInputBuilder()
      .setCustomId('motivo')
      .setLabel('Motivo do bloqueio')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMinLength(4)
      .setMaxLength(200);
    const provaInput = new TextInputBuilder()
      .setCustomId('prova')
      .setLabel('Link de prova (opcional)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(200);
    modal.addComponents(
      new ActionRowBuilder().addComponents(idInput),
      new ActionRowBuilder().addComponents(motivoInput),
      new ActionRowBuilder().addComponents(provaInput)
    );
    await interaction.showModal(modal);
  }
};
