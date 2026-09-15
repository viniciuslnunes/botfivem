const config = require('../../config/index.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const E = require('./estatisticas');
const F = require('./painelFormato');
const A = require('./analises');
const repo = require('./repositorio');
const { selectPeriodo, selectBuscarJogador, linhaPaginacao } = require('./painelComponentesFixos');
const { criarArmazemConsultas, mensagemErroConsulta } = require('./consultasEmMemoria');

// Canal 🔐・fechaduras: mesmo padrão interativo do 📦・estoque-bau. São só ~10
// fechaduras conhecidas (cabe numa mensagem só, sem paginação) — a mensagem
// fixa (embedEstadoAtual) já mostra o estado + quem mexeu, então não existe
// botão "ESTADO ATUAL" aqui (removido em 2026-09-15: virou redundante assim
// que o card fixo passou a trazer essa informação). Período fica pro
// histórico de movimentos (buscarDadosHistorico/renderizarHistorico), que
// traz o PERÍODO INTEIRO (não um teto fixo de linhas) e pagina como o
// 📦・estoque-bau — pedido do usuário em 2026-09-15: um corte de "últimos 50"
// escondia parte do período escolhido (7d/30d podem passar de 800 eventos).
const MODULO = 'fechaduras';
const ACOES_ARENA = ['arena_bloqueou', 'arena_desbloqueou'];
const ORIGEM = 'canal logs-registros';
const LIMITE_FICHA = 50;
const armazem = criarArmazemConsultas();

// Rótulo curto de um evento pra linha de histórico/ficha — mesma ideia do
// fechaduraDoEvento de analises.js, mas já com o verbo (trancou/destrancou/
// bloqueou/liberou) pra não repetir "sede" duas vezes na mesma linha como o
// `acao` cru fazia (ex.: "sede_trancou — sede").
function rotuloEvento(e) {
  if (ACOES_ARENA.includes(e.acao)) return e.acao === 'arena_bloqueou' ? 'bloqueou a arena' : 'liberou a arena';
  // "destrancou" TERMINA em "trancou" — checar destrancou primeiro, senão todo
  // evento vira "trancou" (bug real: histórico de 2026-09-15 saiu só com
  // "trancou a sede", mesmo com sede_destrancou quase empatado nas contagens).
  const trancou = !e.acao.endsWith('destrancou');
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
// jogador (buscarDadosHistorico, embedFichaJogador) — só a visão "estado
// atual" para de listar o que não é mais estado atual de verdade.
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
      name: '🎯 ARENA (BLOQUEIO DE USO)',
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
// mexeu". Traz o PERÍODO INTEIRO (sede+portão+arena juntos, ordenados só por
// data — sem separar por tipo) e pagina como o estoque-bau; um teto fixo de
// linhas escondia parte do período (7d passa fácil de 800 eventos).
const TETO_HISTORICO = 100000; // não é um corte real, só o LIMIT do SQL

function contagensPorAcao(eventos) {
  const mapa = new Map();
  for (const e of eventos) mapa.set(e.acao, (mapa.get(e.acao) ?? 0) + 1);
  return [...mapa.entries()].sort((a, b) => b[1] - a[1]).map(([acao, total]) => ({ acao, total }));
}

async function buscarDadosHistorico(periodo) {
  const acoes = [...A.ACOES_FECHADURA, ...ACOES_ARENA];
  const eventos = await repo.listarPorAcoes(acoes, periodo, TETO_HISTORICO);
  return { periodo, pagina: 0, eventos };
}

function renderizarHistorico(consultaId, consulta) {
  const { itens, atual, totalPaginas } = armazem.pagina(consulta.eventos, consulta.pagina);
  const contagens = contagensPorAcao(consulta.eventos);
  const embed = {
    color: F.COR,
    title: `🔐 HISTÓRICO DE FECHADURAS — ${consulta.periodo.rotulo}`,
    description: `**${E.formatarNumero(consulta.eventos.length)}** ${consulta.eventos.length === 1 ? 'movimento' : 'movimentos'} no período.`,
    fields: [
      ...F.campoLista('MOVIMENTOS', itens.map(linhaMovimento), 'Sem dados nesta página.', { numerar: false }),
      ...(contagens.length ? [{ name: 'POR TIPO DE EVENTO', value: E.truncar(contagens.map(c => `• ${c.acao}: ${E.formatarNumero(c.total)}`).join('\n'), 1024) }] : []),
    ],
    footer: { text: `${F.rodape(ORIGEM)} · Página ${atual + 1}/${totalPaginas}` },
  };
  return { embeds: [embed], components: [linhaPaginacao(MODULO, consultaId, atual, totalPaginas, { comBusca: false })], allowedMentions: { parse: [] } };
}

async function embedFichaJogador(idFivem, nomeConhecido) {
  const eventos = await repo.eventosDoAtor(idFivem, [...A.ACOES_FECHADURA, ...ACOES_ARENA], LIMITE_FICHA);
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
  const [, acao, a, b] = interaction.customId.split(':');

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
    const dados = await buscarDadosHistorico(E.resolverPeriodo(interaction.values[0]));
    const consultaId = armazem.salvar(interaction.user.id, dados);
    await interaction.editReply(renderizarHistorico(consultaId, dados));
    return;
  }

  if (interaction.isButton() && acao === 'pag') {
    const { erro } = armazem.obter(a, interaction.user.id);
    if (erro) return interaction.update({ content: mensagemErroConsulta(erro), embeds: [], components: [] });
    const atualizada = armazem.atualizar(a, { pagina: Number(b) || 0 });
    await interaction.update(renderizarHistorico(a, atualizada));
    return;
  }
});

module.exports = { linhaComponentesFechaduras, embedEstadoAtual };
