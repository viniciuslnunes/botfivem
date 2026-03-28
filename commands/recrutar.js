const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recrutar')
    .setDescription('Solicite seu recrutamento!'),
  async execute(interaction) {
    // Abrir modal para preenchimento dos dados
    const modal = new ModalBuilder()
      .setCustomId('modal_recrutamento')
      .setTitle('Formulário de Recrutamento');

    const nomeInput = new TextInputBuilder()
      .setCustomId('nome')
      .setLabel('Nome')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    const idadeInput = new TextInputBuilder()
      .setCustomId('idade')
      .setLabel('Idade')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    const idFiveMInput = new TextInputBuilder()
      .setCustomId('id_fivem')
      .setLabel('ID FiveM')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    const telefoneInput = new TextInputBuilder()
      .setCustomId('telefone')
      .setLabel('Telefone')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    const recrutadorInput = new TextInputBuilder()
      .setCustomId('recrutador')
      .setLabel('Recrutador')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(nomeInput),
      new ActionRowBuilder().addComponents(idadeInput),
      new ActionRowBuilder().addComponents(idFiveMInput),
      new ActionRowBuilder().addComponents(telefoneInput),
      new ActionRowBuilder().addComponents(recrutadorInput)
    );
    await interaction.showModal(modal);
  }
};
