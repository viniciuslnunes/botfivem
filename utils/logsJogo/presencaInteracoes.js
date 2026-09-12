const crypto = require('crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const E = require('./estatisticas');
const relatorios = require('./relatorios');

// Botões do painel fixo de jogadores: cada um abre, só pra quem clicou, uma
// consulta paginada (mesmo padrão do /logs) já filtrada num período. Duas
// linhas: janela rolante (a partir de agora) e período civil fechado (o
// anterior).
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

// Consulta paginada: a lista inteira (quem está online, ou o ranking de
// tempo jogado) fica em memória, identificada no customId dos botões — uma
// lista de centenas de jogadores não cabe num embed só.
const POR_PAGINA = 25;
const TTL_MS = 15 * 60 * 1000;
const consultas = new Map();

function limparExpiradas() {
  const agora = Date.now();
  for (const [id, consulta] of consultas) {
    if (agora - consulta.criadoEm > TTL_MS) consultas.delete(id);
  }
}

function renderizarPagina(consultaId, consulta, pagina) {
  const total = consulta.linhas.length;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const atual = Math.min(Math.max(0, pagina), totalPaginas - 1);
  const fatia = consulta.linhas.slice(atual * POR_PAGINA, (atual + 1) * POR_PAGINA);

  const embed = {
    color: 0x000000,
    title: consulta.titulo,
    description: consulta.linhaTopo,
    fields: [
      consulta.resumo,
      { name: `${consulta.tituloLista} (${E.formatarNumero(total)})`, value: fatia.join('\n') || '*Sem dados.*', inline: false },
    ],
    footer: { text: `Com base nos logs do jogo recebidos pelo webhook · canal logs-painel · Página ${atual + 1}/${totalPaginas}` },
  };
  const botoes = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`presenca:pag:${consultaId}:${atual - 1}`)
      .setLabel('◀ ANTERIOR')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atual === 0),
    new ButtonBuilder()
      .setCustomId(`presenca:pag:${consultaId}:${atual + 1}`)
      .setLabel('PRÓXIMA ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atual >= totalPaginas - 1)
  );
  return { embeds: [embed], components: totalPaginas > 1 ? [botoes] : [], allowedMentions: { parse: [] } };
}

async function abrirPresenca(interaction, periodo) {
  limparExpiradas();
  const dados = await relatorios.montarDadosPresenca(periodo);
  const consultaId = crypto.randomBytes(6).toString('hex');
  const consulta = { ...dados, userId: interaction.user.id, criadoEm: Date.now() };
  consultas.set(consultaId, consulta);
  await interaction.editReply(renderizarPagina(consultaId, consulta, 0));
}

registrarModulo('presenca', async interaction => {
  if (!interaction.isButton()) return;
  const [, acao, a, b] = interaction.customId.split(':');

  if (acao === 'ver') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    await abrirPresenca(interaction, E.resolverPeriodo(a));
    return;
  }

  if (acao === 'pag') {
    const consulta = consultas.get(a);
    if (!consulta || Date.now() - consulta.criadoEm > TTL_MS) {
      return interaction.update({ content: '⌛ ESTA CONSULTA EXPIROU. CLIQUE NO PERÍODO DE NOVO.', embeds: [], components: [] });
    }
    if (consulta.userId !== interaction.user.id) {
      return interaction.reply({ content: '❌ ESSA CONSULTA NÃO É SUA.', flags: 64 });
    }
    await interaction.deferUpdate();
    await interaction.editReply(renderizarPagina(a, consulta, Number(b) || 0));
  }
});

module.exports = { linhaBotoesPresenca, abrirPresenca };
