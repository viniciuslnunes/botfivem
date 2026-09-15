const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../utils/permissoes');
const { reprocessarFormatacaoDiasFechados } = require('../utils/logsJogo/registrosDiarios');

// Comando de manutenção pontual: reedita a FORMATAÇÃO dos dias já fechados no
// canal de registros-diários (rótulo, numeração das listas etc.) sem
// recalcular nada que mudaria o resultado — um dia fechado não recebe log
// novo, então os números saem idênticos, só a apresentação muda. Não toca no
// banco (só leitura, via montarDadosPresenca) e reaproveita as mesmas
// mensagens já publicadas (edita por ID), sem apagar nem duplicar histórico.
// Existe pra corrigir o acervo já publicado depois de um ajuste visual em
// registrosDiarios.js (ver linhaJogador: números 99/100 fantasmas do parser
// de lista do Discord, corrigido em 2026-09-15).
module.exports = {
  data: new SlashCommandBuilder()
    .setName('registros-diarios-reformatar')
    .setDescription('Reedita a formatação dos dias já fechados no canal de registros-diários (não recalcula números)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!ehLideranca(interaction.member)) {
      return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    }
    await interaction.deferReply({ flags: 64 });

    const reeditados = await reprocessarFormatacaoDiasFechados(interaction.client);

    await interaction.editReply({ content: `**REFORMATAÇÃO CONCLUÍDA** — ${reeditados} dia(s) reeditado(s) no canal de registros-diários.` });
  },
};
