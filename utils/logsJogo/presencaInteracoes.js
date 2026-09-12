const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const E = require('./estatisticas');
const relatorios = require('./relatorios');

// Botões do painel fixo de jogadores: cada um abre, só pra quem clicou, o
// mesmo cálculo do /estatisticas online já filtrado num período. Duas linhas:
// janela rolante (a partir de agora) e período civil fechado (o anterior).
const LINHA_ROLANTE = [
  { chave: 'hoje', label: 'AGORA' },
  { chave: '7d', label: 'ÚLTIMOS 7 DIAS' },
  { chave: '30d', label: 'ÚLTIMOS 30 DIAS' },
];
const LINHA_FECHADA = [
  { chave: 'ontem', label: 'ONTEM' },
  { chave: 'semana_passada', label: 'SEMANA PASSADA' },
  { chave: 'mes_passado', label: 'MÊS PASSADO' },
];

function linhaDeBotoes(botoes) {
  return new ActionRowBuilder().addComponents(
    ...botoes.map(b => new ButtonBuilder()
      .setCustomId(`presenca:ver:${b.chave}`)
      .setLabel(b.label)
      .setStyle(ButtonStyle.Secondary))
  );
}

function linhaBotoesPresenca() {
  return [linhaDeBotoes(LINHA_ROLANTE), linhaDeBotoes(LINHA_FECHADA)];
}

registrarModulo('presenca', async interaction => {
  if (!interaction.isButton()) return;
  const [, acao, chave] = interaction.customId.split(':');
  if (acao !== 'ver') return;
  if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });

  await interaction.deferReply({ flags: 64 });
  const embed = await relatorios.montarEmbedPresenca(E.resolverPeriodo(chave));
  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
});

module.exports = { linhaBotoesPresenca };
