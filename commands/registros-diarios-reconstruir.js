const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../utils/permissoes');
const { reconstruirAcervoCompleto } = require('../utils/logsJogo/registrosDiarios');

// Comando de manutenção pontual (diferente de /registros-diarios-reformatar,
// que só reedita o que já existe): apaga TODA mensagem do canal de
// registros-diários e recria o acervo do zero, dia após dia em ordem
// cronológica, desde o primeiro log de entrada/saída registrado até hoje —
// preenche dias que nunca tiveram registro (ex.: histórico anterior a este
// canal existir). Só leitura no banco; nada some, só a apresentação no
// Discord é refeita. Pedido do usuário em 2026-09-17.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('registros-diarios-reconstruir')
    .setDescription('Apaga e recria TODO o histórico de registros-diários, dia a dia, desde o primeiro registro')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!ehLideranca(interaction.member)) {
      return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    }
    await interaction.deferReply({ flags: 64 });

    const { apagadas, criados } = await reconstruirAcervoCompleto(interaction.client);

    await interaction.editReply({
      content: `**RECONSTRUÇÃO CONCLUÍDA** — ${apagadas} mensagem(ns) apagada(s), ${criados} dia(s) recriado(s) no canal de registros-diários.`,
    });
  },
};
