const config = require('../../config/index.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const E = require('./estatisticas');
const F = require('./painelFormato');
const A = require('./analises');
const repo = require('./repositorio');
const { selectPeriodo, selectBuscarJogador } = require('./painelComponentesFixos');

// Canal 🔐・fechaduras: mesmo padrão interativo do 📦・estoque-bau. São só ~10
// fechaduras conhecidas (cabe numa mensagem só, sem paginação) — a mensagem
// fixa (embedEstadoAtual) já mostra o estado + quem mexeu, então não existe
// botão "ESTADO ATUAL" aqui (removido em 2026-09-15: virou redundante assim
// que o card fixo passou a trazer essa informação). Período fica pro
// histórico de movimentos (embedHistorico).
const MODULO = 'fechaduras';
const ACOES_ARENA = ['arena_bloqueou', 'arena_desbloqueou'];
const ORIGEM = 'canal logs-registros';
const LIMITE_HISTORICO = 50;

// Rótulo curto de um evento pra linha de histórico/ficha — mesma ideia do
// fechaduraDoEvento de analises.js, mas já com o verbo (trancou/destrancou/
// bloqueou/liberou) pra não repetir "sede" duas vezes na mesma linha como o
// `acao` cru fazia (ex.: "sede_trancou — sede").
function rotuloEvento(e) {
  if (ACOES_ARENA.includes(e.acao)) return e.acao === 'arena_bloqueou' ? 'bloqueou a arena' : 'liberou a arena';
  const trancou = e.acao.endsWith('trancou');
  if (e.acao.startsWith('sede_')) return `${trancou ? 'trancou' : 'destrancou'} a sede`;
  if (e.acao.startsWith('portao_')) return `${trancou ? 'trancou' : 'destrancou'} o portão`;
  return `${trancou ? 'trancou' : 'destrancou'} ${F.nomeSeguro(e.alvo_nome ?? 'a fechadura')}`;
}

function linhaMovimento(e) {
  return `${F.pessoa({ nome: e.ator_nome, id: e.ator_id_fivem })} — ${rotuloEvento(e)} — ${E.formatarDataHora(e.ocorrido_em)}`;
}

// Ativa (log recente): estado + há quanto tempo + quem mexeu — é o que pede
// ação, então leva o detalhe todo.
function linhaAtiva(f) {
  return `${f.destrancada ? '🔓' : '🔒'} **${f.fechadura.toUpperCase()}** — ${f.destrancada ? 'DESTRANCADA' : 'trancada'} ${F.haQuantoTempo(f.em)}`
    + (f.porNome || f.porId ? ` · ${F.pessoa({ nome: f.porNome, id: f.porId })}` : '');
}

// Situação vira grupos visuais (fields) em vez de uma pilha só: destrancada
// (pede ação) e trancada (ok), cada um com seu próprio respiro.
//
// Fechadura sem log há mais de `fonteParadaDias` (`semLogRecente`) fica FORA
// do embed de propósito (pedido do usuário em 2026-09-14, caso real: portão
// parado desde 28/01/2026 — 4.139 registros virando uma linha morta no
// painel, sem nada pra fazer a respeito). A inteligência continua íntegra:
// os logs seguem no banco (não apagados) e valem pro histórico/ficha de
// jogador (embedHistorico, embedFichaJogador) — só a visão "estado atual"
// para de listar o que não é mais estado atual de verdade.
async function embedEstadoAtual() {
  const [eventos, arena] = await Promise.all([
    repo.ultimoPorFechadura(A.ACOES_FECHADURA),
    repo.listarPorAcoes(ACOES_ARENA, E.resolverPeriodo('tudo'), 1),
  ]);
  const estado = A.estadoFechaduras(eventos, { limiteMs: config.logsJogo.fonteParadaDias * E.DIA_MS });
  const destrancadas = estado.filter(f => f.destrancada && !f.semLogRecente);
  const trancadas = estado.filter(f => !f.destrancada && !f.semLogRecente);
  const ultimaArena = arena[0] ?? null;

  const fields = [
    ...F.campoLista('🔓 DESTRANCADAS AGORA', destrancadas.map(linhaAtiva), 'Nenhuma.'),
    ...(trancadas.length ? F.campoLista('🔒 TRANCADAS', trancadas.map(linhaAtiva), '') : []),
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

// Histórico (não ranking): quem mexeu, quando e o que fez, em ordem
// cronológica — pedido do usuário em 2026-09-15 pra poder responder "nessa
// data, qual foi a movimentação de fechaduras?" em vez de só "quem mais
// mexeu". A contagem por tipo de evento continua junto, como resumo do
// período.
async function embedHistorico(periodo) {
  const acoes = [...A.ACOES_FECHADURA, ...ACOES_ARENA];
  const [eventos, contagens] = await Promise.all([
    repo.listarPorAcoes(acoes, periodo, LIMITE_HISTORICO),
    repo.contarPorAcoes(acoes, periodo),
  ]);
  return {
    color: F.COR,
    title: `🔐 HISTÓRICO DE FECHADURAS — ${periodo.rotulo}`,
    description: eventos.length === LIMITE_HISTORICO ? `Últimos ${LIMITE_HISTORICO} movimentos do período.` : undefined,
    fields: [
      ...F.campoLista('MOVIMENTOS', eventos.map(linhaMovimento), 'Sem dados no período.'),
      ...(contagens.length ? [{ name: 'POR TIPO DE EVENTO', value: E.truncar(contagens.map(c => `• ${c.acao}: ${E.formatarNumero(c.total)}`).join('\n'), 1024) }] : []),
    ],
    footer: { text: F.rodape(ORIGEM) },
    timestamp: new Date().toISOString(),
  };
}

async function embedFichaJogador(idFivem, nomeConhecido) {
  const eventos = await repo.eventosDoAtor(idFivem, [...A.ACOES_FECHADURA, ...ACOES_ARENA], LIMITE_HISTORICO);
  return {
    color: F.COR,
    title: `🔐 ${F.nomeSeguro(nomeConhecido ?? idFivem)} — FECHADURAS`,
    description: [`**ID:** \`${idFivem}\``, `**Total de eventos:** ${E.formatarNumero(eventos.length)}`].join('\n'),
    fields: F.campoLista('ÚLTIMOS MOVIMENTOS', eventos.map(linhaMovimento), 'Nenhum movimento registrado.'),
    footer: { text: F.rodape(ORIGEM) },
  };
}

function linhaComponentesFechaduras() {
  return [
    selectBuscarJogador(MODULO),
    selectPeriodo(MODULO, { placeholder: 'VER HISTÓRICO DE UM PERÍODO' }),
  ];
}

registrarModulo(MODULO, async interaction => {
  const acao = interaction.customId.split(':')[1];

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
    await interaction.editReply({ embeds: [await embedHistorico(E.resolverPeriodo(interaction.values[0]))] });
    return;
  }
});

module.exports = { linhaComponentesFechaduras, embedEstadoAtual };
