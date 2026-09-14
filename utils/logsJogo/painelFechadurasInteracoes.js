const config = require('../../config/index.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const E = require('./estatisticas');
const F = require('./painelFormato');
const A = require('./analises');
const repo = require('./repositorio');
const { selectPeriodo, selectBuscarJogador, linhaBotao } = require('./painelComponentesFixos');

// Canal 🔐・fechaduras: mesmo padrão interativo do 📦・estoque-bau. São só ~10
// fechaduras conhecidas (cabe numa mensagem só, sem paginação) — o botão
// ESTADO ATUAL mostra todas de uma vez; período fica pro ranking de quem mexeu.
const MODULO = 'fechaduras';
const ACOES_ARENA = ['arena_bloqueou', 'arena_desbloqueou'];
const ORIGEM = 'canal logs-registros';

// Ativa (log recente): estado + há quanto tempo + quem mexeu — é o que pede
// ação, então leva o detalhe todo.
function linhaAtiva(f) {
  return `${f.destrancada ? '🔓' : '🔒'} **${f.fechadura.toUpperCase()}** — ${f.destrancada ? 'DESTRANCADA' : 'trancada'} ${F.haQuantoTempo(f.em)}`
    + (f.porNome || f.porId ? ` · ${F.pessoa({ nome: f.porNome, id: f.porId })}` : '');
}

// Sem log recente: não é "estado atual" de verdade, só o último conhecido — uma
// linha só com a data, sem "por fulano" (informação de baixa prioridade aqui).
function linhaSemLog(f) {
  return `**${f.fechadura.toUpperCase()}** — desde ${E.formatarDataHora(f.em)} (${f.destrancada ? 'destrancada' : 'trancada'})`;
}

// Situação vira 3 grupos visuais (fields) em vez de uma pilha só: é a mesma
// informação de antes, mas separada por relevância — destrancada (pede ação),
// trancada (ok) e sem log (baixa confiança), cada um com seu próprio respiro.
async function embedEstadoAtual() {
  const [eventos, arena] = await Promise.all([
    repo.ultimoPorFechadura(A.ACOES_FECHADURA),
    repo.listarPorAcoes(ACOES_ARENA, E.resolverPeriodo('tudo'), 1),
  ]);
  const estado = A.estadoFechaduras(eventos, { limiteMs: config.logsJogo.fonteParadaDias * E.DIA_MS });
  const destrancadas = estado.filter(f => f.destrancada && !f.semLogRecente);
  const trancadas = estado.filter(f => !f.destrancada && !f.semLogRecente);
  const semLog = estado.filter(f => f.semLogRecente);
  const ultimaArena = arena[0] ?? null;

  const fields = [
    ...F.campoLista('🔓 DESTRANCADAS AGORA', destrancadas.map(linhaAtiva), 'Nenhuma.'),
    ...(trancadas.length ? F.campoLista('🔒 TRANCADAS', trancadas.map(linhaAtiva), '') : []),
    ...(semLog.length ? F.campoLista(`SEM LOG HÁ MAIS DE ${config.logsJogo.fonteParadaDias} DIAS`, semLog.map(linhaSemLog), '') : []),
  ];
  if (ultimaArena) {
    const parada = F.avisoFonteParada(ultimaArena.ocorrido_em);
    fields.push({
      name: '🎯 ARENA (BLOQUEIO DE USO, NÃO FECHADURA)',
      value: `${ultimaArena.acao === 'arena_bloqueou' ? '⛔ BLOQUEADA' : 'LIBERADA'} ${F.haQuantoTempo(ultimaArena.ocorrido_em)}`
        + ` · ${F.pessoa({ nome: ultimaArena.ator_nome, id: ultimaArena.ator_id_fivem })}${parada ? ' · sem log recente' : ''}`,
    });
  }
  return {
    color: F.COR,
    title: '🔐 FECHADURAS DA SEDE — ESTADO ATUAL',
    description: destrancadas.length
      ? `**${destrancadas.length}** ${destrancadas.length === 1 ? 'fechadura pede atenção' : 'fechaduras pedem atenção'} agora.`
      : 'Nenhuma fechadura com log recente está destrancada.',
    fields,
    footer: { text: F.rodape(ORIGEM) },
  };
}

async function embedRanking(periodo) {
  const acoes = [...A.ACOES_FECHADURA, ...ACOES_ARENA];
  const [topMexeu, contagens] = await Promise.all([
    repo.topAtoresPorAcoes(acoes, periodo, 10),
    repo.contarPorAcoes(acoes, periodo),
  ]);
  return {
    color: F.COR,
    title: `🏆 QUEM MAIS MEXEU EM FECHADURA — ${periodo.rotulo}`,
    fields: [
      ...F.campoLista('RANKING', topMexeu.map((l, i) => `${i + 1}. ${F.pessoa(l)} — ${E.formatarNumero(l.total)} ${l.total === 1 ? 'vez' : 'vezes'}`), 'Sem dados no período.'),
      ...(contagens.length ? [{ name: 'POR TIPO DE EVENTO', value: E.truncar(contagens.map(c => `• ${c.acao}: ${E.formatarNumero(c.total)}`).join('\n'), 1024) }] : []),
    ],
    footer: { text: F.rodape(ORIGEM) },
    timestamp: new Date().toISOString(),
  };
}

async function embedFichaJogador(idFivem, nomeConhecido) {
  const eventos = await repo.eventosDoAtor(idFivem, [...A.ACOES_FECHADURA, ...ACOES_ARENA], 10);
  return {
    color: F.COR,
    title: `🔐 ${F.nomeSeguro(nomeConhecido ?? idFivem)} — FECHADURAS`,
    description: [`**ID:** \`${idFivem}\``, `**Total de eventos:** ${E.formatarNumero(eventos.length)}`].join('\n'),
    fields: F.campoLista('ÚLTIMOS MOVIMENTOS', eventos.map(e => `• ${e.acao} — ${F.nomeSeguro(e.alvo_nome ?? 'sede')} — ${E.formatarDataHora(e.ocorrido_em)}`), 'Nenhum movimento registrado.'),
    footer: { text: F.rodape(ORIGEM) },
  };
}

function linhaComponentesFechaduras() {
  return [
    linhaBotao(MODULO, 'estado', 'ESTADO ATUAL', { emoji: '🔐' }),
    selectBuscarJogador(MODULO),
    selectPeriodo(MODULO, { placeholder: 'VER RANKING DE UM PERÍODO' }),
  ];
}

registrarModulo(MODULO, async interaction => {
  const acao = interaction.customId.split(':')[1];

  if (interaction.isButton() && acao === 'estado') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    await interaction.editReply({ embeds: [await embedEstadoAtual()] });
    return;
  }

  if (interaction.isUserSelectMenu() && acao === 'buscarjogador') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const membro = interaction.members.first();
    const idFivem = E.idFivemDoNick(membro?.nickname ?? membro?.displayName);
    if (!idFivem) {
      return interaction.reply({ content: `❌ ${membro ?? 'ESSE MEMBRO'} NÃO TEM ID DO JOGO NO APELIDO (PADRÃO "... - 1234").`, flags: 64, allowedMentions: { parse: [] } });
    }
    await interaction.deferReply({ flags: 64 });
    await interaction.editReply({ embeds: [await embedFichaJogador(idFivem, membro.displayName)] });
    return;
  }

  if (interaction.isStringSelectMenu() && acao === 'selperiodo') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    await interaction.editReply({ embeds: [await embedRanking(E.resolverPeriodo(interaction.values[0]))] });
    return;
  }
});

module.exports = { linhaComponentesFechaduras, embedEstadoAtual };
