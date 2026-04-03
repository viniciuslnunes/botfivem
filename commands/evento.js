const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('evento')
    .setDescription('Cria um evento com lista de confirmação de presença'),
  async execute(interaction) {
    const modal = new ModalBuilder()
      .setCustomId('modal_evento')
      .setTitle('Criar Evento');

    const tituloInput = new TextInputBuilder()
      .setCustomId('titulo')
      .setLabel('Título do Evento')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100);

    const horarioInput = new TextInputBuilder()
      .setCustomId('horario')
      .setLabel('Horário')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(50);

    modal.addComponents(
      new ActionRowBuilder().addComponents(tituloInput),
      new ActionRowBuilder().addComponents(horarioInput)
    );

    await interaction.showModal(modal);
  }
};
