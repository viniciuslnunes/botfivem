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
const ORIGEM = 'canais logs-registros e logs-liderança';

function linhaFechadura(f) {
  const por = f.porNome || f.porId ? ` · por ${F.pessoa({ nome: f.porNome, id: f.porId })}` : '';
  if (f.semLogRecente) {
    return `⚪ **${f.fechadura.toUpperCase()}** — sem log desde ${E.formatarDataHora(f.em)} (último estado: ${f.destrancada ? 'destrancada' : 'trancada'})${por}`;
  }
  return `${f.destrancada ? '🔓' : '🔒'} **${f.fechadura.toUpperCase()}** — ${f.destrancada ? 'DESTRANCADA' : 'trancada'} ${F.haQuantoTempo(f.em)}${por}`;
}

async function embedEstadoAtual() {
  const [eventos, arena] = await Promise.all([
    repo.ultimoPorFechadura(A.ACOES_FECHADURA),
    repo.listarPorAcoes(ACOES_ARENA, E.resolverPeriodo('tudo'), 1),
  ]);
  const estado = A.estadoFechaduras(eventos, { limiteMs: config.logsJogo.fonteParadaDias * E.DIA_MS });
  const destrancadas = estado.filter(f => f.destrancada && !f.semLogRecente);
  const semLog = estado.filter(f => f.semLogRecente);
  const ultimaArena = arena[0] ?? null;

  const fields = [];
  if (ultimaArena) {
    const parada = F.avisoFonteParada(ultimaArena.ocorrido_em);
    fields.push({
      name: 'ARENA (BLOQUEIO DE USO, NÃO FECHADURA)',
      value: `${ultimaArena.acao === 'arena_bloqueou' ? '⛔ BLOQUEADA' : '✅ liberada'} ${F.haQuantoTempo(ultimaArena.ocorrido_em)}`
        + ` · por ${F.pessoa({ nome: ultimaArena.ator_nome, id: ultimaArena.ator_id_fivem })}${parada ? ' · ⚪ sem log recente' : ''}`,
    });
  }
  return {
    color: F.COR,
    title: '🔐 FECHADURAS DA SEDE — ESTADO ATUAL',
    description: [
      destrancadas.length
        ? `**${destrancadas.length}** ${destrancadas.length === 1 ? 'fechadura está DESTRANCADA' : 'fechaduras estão DESTRANCADAS'} agora.`
        : 'Nenhuma fechadura com log recente está destrancada. ✅',
      semLog.length ? `⚪ **${semLog.length}** sem log há mais de ${config.logsJogo.fonteParadaDias} dias.` : null,
      '',
      estado.map(linhaFechadura).join('\n') || '*Nenhum evento de fechadura registrado ainda.*',
    ].filter(Boolean).join('\n'),
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
    description: topMexeu.map((l, i) => `${i + 1}. ${F.pessoa(l)} — ${E.formatarNumero(l.total)} ${l.total === 1 ? 'vez' : 'vezes'}`).join('\n') || '*Sem dados no período.*',
    fields: contagens.length ? [{ name: 'POR TIPO DE EVENTO', value: E.truncar(contagens.map(c => `• ${c.acao}: ${E.formatarNumero(c.total)}`).join('\n'), 1024) }] : [],
    footer: { text: F.rodape(ORIGEM) },
    timestamp: new Date().toISOString(),
  };
}

async function embedFichaJogador(idFivem, nomeConhecido) {
  const eventos = await repo.eventosDoAtor(idFivem, [...A.ACOES_FECHADURA, ...ACOES_ARENA], 10);
  return {
    color: F.COR,
    title: `🔐 ${F.nomeSeguro(nomeConhecido ?? idFivem)} — FECHADURAS`,
    description: [
      `**ID:** \`${idFivem}\``,
      `**Total de eventos:** ${E.formatarNumero(eventos.length)}`,
      '',
      eventos.length ? '**Últimos movimentos:**' : '*Nenhum movimento registrado.*',
      ...eventos.map(e => `• ${e.acao} — ${F.nomeSeguro(e.alvo_nome ?? 'sede')} — ${E.formatarDataHora(e.ocorrido_em)}`),
    ].join('\n'),
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
