const { SlashCommandBuilder } = require('discord.js');
const { ehLideranca, ehRecrutadorOuAcima, MSG_SO_LIDERANCA } = require('../utils/permissoes');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('merito')
    .setDescription('Mostra o extrato do seu mérito de recrutador: pontos, semanas na meta e como subir')
    .addUserOption(option =>
      option.setName('recrutador')
        .setDescription('Só liderança: ver o extrato de outro recrutador')
        .setRequired(false)),
  async execute(interaction) {
    const alvo = interaction.options.getUser('recrutador');
    if (alvo && alvo.id !== interaction.user.id && !ehLideranca(interaction.member)) {
      return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    }
    if (!alvo && !ehRecrutadorOuAcima(interaction.member)) {
      return interaction.reply({ content: '❌ SÓ RECRUTADORES E ACIMA USAM O MÉRITO.', flags: 64 });
    }
    await interaction.deferReply({ flags: 64 });
    const alvoId = alvo?.id ?? interaction.user.id;
    const membro = alvo ? await interaction.guild.members.fetch(alvoId).catch(() => null) : interaction.member;
    const { payloadExtrato } = require('../utils/merito/interacoes');
    return interaction.editReply(await payloadExtrato(alvoId, membro?.displayName ?? alvo?.username, false));
  },
};
