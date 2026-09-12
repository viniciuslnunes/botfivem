const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const E = require('./estatisticas');
const relatorios = require('./relatorios');

// Botões do painel fixo de jogadores: cada um abre, só pra quem clicou, o
// mesmo cálculo do /estatisticas online já filtrado num período.
const BOTOES = [
  { chave: 'hoje', label: 'HOJE (POR HORA)' },
  { chave: '7d', label: 'SEMANA (POR DIA)' },
  { chave: '30d', label: 'MÊS (POR DIA)' },
];

function linhaBotoesPresenca() {
  return new ActionRowBuilder().addComponents(
    ...BOTOES.map(b => new ButtonBuilder()
      .setCustomId(`presenca:ver:${b.chave}`)
      .setLabel(b.label)
      .setStyle(ButtonStyle.Secondary))
  );
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
