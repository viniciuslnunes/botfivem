const { SlashCommandBuilder } = require('discord.js');
const { buscarBloqueio } = require('../utils/naoRecrutar');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('validarid')
    .setDescription('Valida se um ID está impedido de ser recrutado')
    .addStringOption(option =>
      option.setName('id')
        .setDescription('ID FiveM para consultar')
        .setRequired(true)),
  async execute(interaction) {
    const id = interaction.options.getString('id').trim();
    // O histórico inteiro é lido (pode levar alguns segundos): deferir antes
    await interaction.deferReply({ flags: 64 });
    let encontrado;
    try {
      encontrado = await buscarBloqueio(interaction.client, id);
    } catch (err) {
      console.error('[validarid] Erro ao buscar histórico:', err);
      return interaction.editReply({ content: 'Erro ao buscar histórico.' });
    }
    if (encontrado) {
      return interaction.editReply({ embeds: [encontrado] });
    }
    return interaction.editReply({ content: `ID ${id} não possui impedimento registrado.` });
  }
};
