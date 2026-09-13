const config = require('../../config/index.js');
const repo = require('./repositorio');
const E = require('./estatisticas');
const F = require('./painelFormato');
const A = require('./analises');
const { criarPainelCanal } = require('./painelCanal');
const { registrarConsulta, selectPeriodo } = require('./painelConsulta');

// Canal 🔐・fechaduras: o estado de TODA fechadura da sede, não só sede e portão
// (que eram as duas que o módulo de segurança vigiava). O jogo também tranca
// arena, vestiário, proteção, baú, novato e entrada automática — 1.400 eventos
// que até agora não eram lidos por ninguém.
//
// Destrancada primeiro, e há quanto tempo: é a informação que gera ação. Mas só
// conta como "destrancada agora" a fechadura com log recente: as que só vinham do
// canal logs-liderança (parado desde 2026-07) aparecem como "último estado
// conhecido", senão o painel alardearia porta aberta com base em evento de
// janeiro. O alerta automático de "destrancada com ninguém online" continua em
// seguranca.js (sede/portão).
const SLUG = 'fechaduras';
const ACOES_ARENA = ['arena_bloqueou', 'arena_desbloqueou'];
const TOP = 10;
const ORIGEM = 'canais logs-registros e logs-liderança';

function linhaFechadura(f) {
  const por = f.porNome || f.porId ? ` · por ${F.pessoa({ nome: f.porNome, id: f.porId })}` : '';
  if (f.semLogRecente) {
    return `⚪ **${f.fechadura.toUpperCase()}** — sem log desde ${E.formatarDataHora(f.em)} `
      + `(último estado: ${f.destrancada ? 'destrancada' : 'trancada'})${por}`;
  }
  return `${f.destrancada ? '🔓' : '🔒'} **${f.fechadura.toUpperCase()}** — `
    + `${f.destrancada ? 'DESTRANCADA' : 'trancada'} ${F.haQuantoTempo(f.em)}${por}`;
}

function linhaTop(l, i) {
  return `${i + 1}. ${F.pessoa(l)} — ${E.formatarNumero(l.total)} ${l.total === 1 ? 'vez' : 'vezes'}`;
}

async function montarBlocos() {
  const mes = E.resolverPeriodo('30d');
  const [eventos, arena, topMexeu, contagens] = await Promise.all([
    repo.ultimoPorFechadura(A.ACOES_FECHADURA),
    repo.listarPorAcoes(ACOES_ARENA, E.resolverPeriodo('tudo'), 1),
    repo.topAtoresPorAcoes([...A.ACOES_FECHADURA, ...ACOES_ARENA], mes, TOP),
    repo.contarPorAcoes([...A.ACOES_FECHADURA, ...ACOES_ARENA], mes),
  ]);

  const estado = A.estadoFechaduras(eventos, { limiteMs: config.logsJogo.fonteParadaDias * E.DIA_MS });
  const destrancadas = estado.filter(f => f.destrancada && !f.semLogRecente);
  const semLog = estado.filter(f => f.semLogRecente);
  const ultimaArena = arena[0] ?? null;

  const fields = [];
  if (ultimaArena) {
    // Bloquear a arena é outro sistema: não é a porta dela, é o uso. Só o último
    // estado, fora da lista de fechaduras.
    const parada = F.avisoFonteParada(ultimaArena.ocorrido_em);
    fields.push({
      name: 'ARENA (BLOQUEIO DE USO, NÃO FECHADURA)',
      value: `${ultimaArena.acao === 'arena_bloqueou' ? '⛔ BLOQUEADA' : '✅ liberada'} ${F.haQuantoTempo(ultimaArena.ocorrido_em)}`
        + ` · por ${F.pessoa({ nome: ultimaArena.ator_nome, id: ultimaArena.ator_id_fivem })}`
        + (parada ? ' · ⚪ sem log recente' : ''),
    });
  }
  if (topMexeu.length) {
    fields.push({ name: 'QUEM MAIS MEXEU EM FECHADURA (30 DIAS)', value: E.truncar(topMexeu.map(linhaTop).join('\n'), 1024) });
  }
  const totalMes = contagens.reduce((t, c) => t + c.total, 0);
  if (totalMes) {
    fields.push({ name: 'MOVIMENTO (30 DIAS)', value: `${E.formatarNumero(totalMes)} aberturas/fechamentos registrados` });
  }

  const cabecalho = [
    destrancadas.length
      ? `**${destrancadas.length}** ${destrancadas.length === 1 ? 'fechadura está DESTRANCADA' : 'fechaduras estão DESTRANCADAS'} agora.`
      : 'Nenhuma fechadura com log recente está destrancada. ✅',
  ];
  if (semLog.length) {
    cabecalho.push(`⚪ **${semLog.length}** sem log há mais de ${config.logsJogo.fonteParadaDias} dias: `
      + 'o estado delas é só o último conhecido (a fonte pode ter parado).');
  }

  return F.blocosDeEmbeds(F.embedsDeLista({
    titulo: '🔐 FECHADURAS DA SEDE',
    cabecalho: cabecalho.join('\n'),
    linhas: estado.map(linhaFechadura),
    vazio: 'Nenhum evento de fechadura registrado ainda.',
    origem: ORIGEM,
    fields,
  }));
}

function montarAcao() {
  return {
    content: '👇 **VER O MOVIMENTO DAS FECHADURAS NUM PERÍODO**',
    components: [selectPeriodo(SLUG, 'ESCOLHA UM PERÍODO')],
  };
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '🔐・fechaduras',
  razao: 'Estado das fechaduras da sede a partir dos logs do jogo',
  intervaloMin: 15,
  montarBlocos,
  montarAcao,
});

registrarConsulta(SLUG, async periodo => {
  const acoes = [...A.ACOES_FECHADURA, ...ACOES_ARENA];
  const [topMexeu, contagens] = await Promise.all([
    repo.topAtoresPorAcoes(acoes, periodo, TOP),
    repo.contarPorAcoes(acoes, periodo),
  ]);
  return {
    embeds: F.embedsDeLista({
      titulo: `🔐 FECHADURAS — ${periodo.rotulo}`,
      cabecalho: 'Quem mexeu e quanto (o estado de cada fechadura fica no topo do canal).',
      linhas: topMexeu.map(linhaTop),
      vazio: 'Ninguém mexeu em fechadura no período.',
      origem: ORIGEM,
      fields: contagens.length
        ? [{ name: 'POR TIPO DE EVENTO', value: E.truncar(contagens.map(c => `• ${c.acao}: ${E.formatarNumero(c.total)}`).join('\n'), 1024) }]
        : [],
    }).slice(0, 1),
  };
}, painel.agendarAtualizacaoReativa);

module.exports = {
  iniciarPainelFechaduras: painel.iniciar,
  atualizarPainelFechaduras: painel.atualizar,
  agendarAtualizacaoReativa: painel.agendarAtualizacaoReativa,
};
