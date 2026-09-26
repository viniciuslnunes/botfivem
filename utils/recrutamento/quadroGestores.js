// Quadro de gestores do 📋・quadro-de-recrutadores: cada gestor (quem promoveu a
// pessoa a recrutador no jogo) com os recrutadores ATUAIS dele e uma avaliação do
// time (recrutamentos, média, retenção, fichas aprovadas, advertências). Também lista
// os rebaixados recentes. Regras em docs/contratos/regras-negocio.md.
const config = require('../../config/index.js');
const tema = require('../../tema');
const db = require('../db');
const E = require('../logsJogo/estatisticas');
const repoLogs = require('../logsJogo/repositorio');

const DIA_MS = E.DIA_MS;
const JANELA_DIAS = 30;
const SEMANA_DIAS = 7;
const REBAIXADOS_DIAS = 30;
const LIMITE_EMBED = 3800;
const SEM_GESTOR = 'sem-gestor';

const num = n => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));
const seg = data => Math.floor(new Date(data).getTime() / 1000);
const pct = (parte, total) => (total ? Math.round((parte / total) * 100) : null);

// Menção quando o ID do jogo bate com o apelido de alguém no Discord; senão nome + ID.
function rotuloDePessoa(nome, idFivem, membroPorIdFivem) {
  const membro = idFivem ? membroPorIdFivem.get(idFivem) : null;
  if (membro) return `<@${membro.id}>`;
  return nome ? `**${nome}**${idFivem ? ` \`${idFivem}\`` : ''}` : `\`${idFivem ?? '?'}\``;
}

// ── Regras puras ─────────────────────────────────────────────────────────────

// Média semanal de recrutamentos: a janela nunca é menor que 1 semana (quem entrou
// ontem não vira "50 por semana") nem maior que os 30 dias medidos.
function mediaSemanal(rec30, promovidoEm, agora) {
  const diasNoCargo = promovidoEm ? (agora - new Date(promovidoEm)) / DIA_MS : JANELA_DIAS;
  const janela = Math.min(JANELA_DIAS, Math.max(SEMANA_DIAS, diasNoCargo));
  return rec30 / (janela / SEMANA_DIAS);
}

// Avaliação do time contra a meta semanal por recrutador. Quem ainda está na primeira
// semana de cargo não entra na média (carência): sem ninguém medível, fica "em carência".
function avaliarTime(membros, meta, agora) {
  const medidos = membros.filter(m => !m.promovidoEm || (agora - new Date(m.promovidoEm)) / DIA_MS >= SEMANA_DIAS);
  const rec30 = membros.reduce((s, m) => s + m.rec30, 0);
  const saiuCedo = membros.reduce((s, m) => s + m.saiuCedo30, 0);
  const mediaPorRecrutador = medidos.length ? medidos.reduce((s, m) => s + m.porSemana, 0) / medidos.length : null;
  let veredito = 'EM CARÊNCIA';
  if (mediaPorRecrutador !== null) {
    if (!meta || mediaPorRecrutador >= meta) veredito = 'FLUXO BOM';
    else if (mediaPorRecrutador >= meta / 2) veredito = 'ATENÇÃO';
    else veredito = 'FLUXO FRACO';
  }
  return {
    equipe: membros.length,
    ativos7: membros.filter(m => m.rec7 > 0).length,
    rec30,
    mediaPorRecrutador,
    retencao: pct(rec30 - saiuCedo, rec30),
    aprovadas30: membros.reduce((s, m) => s + m.aprovadas30, 0),
    advertidos: membros.filter(m => m.advNivel > 0).length,
    veredito,
  };
}

const EMOJI_VEREDITO = () => ({
  'FLUXO BOM': tema.emoji.ok, ATENÇÃO: tema.emoji.pendente, 'FLUXO FRACO': tema.emoji.recusado, 'EM CARÊNCIA': tema.emoji.pendente,
});

const ROMANO = { 1: '¹', 2: '²', 3: '³' };

function linhaDoRecrutador(m, membroPorIdFivem, agora) {
  const partes = [
    m.promovidoEm ? `no cargo desde <t:${seg(m.promovidoEm)}:d> (<t:${seg(m.promovidoEm)}:R>)` : 'sem promoção nos logs',
    `${m.rec30} rec. em ${JANELA_DIAS}d`,
    `${num(m.porSemana)}/sem`,
    m.rec30 ? `ret. ${pct(m.rec30 - m.saiuCedo30, m.rec30)}%` : null,
    m.aprovadas30 ? `${m.aprovadas30} aprov.` : null,
    m.advNivel ? `ADV${ROMANO[Math.min(m.advNivel, 3)]}` : null,
    m.promovidoEm && (agora - new Date(m.promovidoEm)) / DIA_MS < SEMANA_DIAS ? 'novo' : null,
  ].filter(Boolean);
  return `↳ ${rotuloDePessoa(m.nome, m.idFivem, membroPorIdFivem)} · ${partes.join(' · ')}`;
}

// Um bloco por gestor: mais recrutamentos primeiro; quem não tem gestor nos logs por último.
function blocosDosTimes(recrutadores, meta, membroPorIdFivem, agora) {
  const times = new Map();
  for (const r of recrutadores) {
    const chave = r.gestorChave ?? SEM_GESTOR;
    if (!times.has(chave)) times.set(chave, { gestor: r.gestor, membros: [] });
    times.get(chave).membros.push(r);
  }
  return [...times.entries()]
    .map(([chave, t]) => ({ chave, ...t, av: avaliarTime(t.membros, meta, agora) }))
    .sort((a, b) => (a.chave === SEM_GESTOR) - (b.chave === SEM_GESTOR) || b.av.rec30 - a.av.rec30)
    .map(({ gestor, membros, av }) => {
      const nome = gestor ? rotuloDePessoa(gestor.nome, gestor.idFivem, membroPorIdFivem) : 'sem promoção registrada nos logs';
      const resumo = [
        `equipe ${av.equipe}`,
        `${av.ativos7}/${av.equipe} recrutaram em ${SEMANA_DIAS}d`,
        `${av.rec30} rec. em ${JANELA_DIAS}d`,
        av.mediaPorRecrutador === null ? 'média em carência' : `média ${num(av.mediaPorRecrutador)}/sem por recrutador (meta ${meta || '—'})`,
        av.retencao === null ? null : `ret. ${av.retencao}%`,
        `${av.aprovadas30} fichas aprovadas`,
        `${av.advertidos} advertido(s)`,
      ].filter(Boolean).join(' · ');
      const linhas = [...membros]
        .sort((a, b) => b.rec30 - a.rec30 || (new Date(b.promovidoEm ?? 0) - new Date(a.promovidoEm ?? 0)))
        .map(m => linhaDoRecrutador(m, membroPorIdFivem, agora));
      return `**Gestor:** ${nome} · ${EMOJI_VEREDITO()[av.veredito]} **${av.veredito}**\n-# ${resumo}\n${linhas.join('\n')}`;
    });
}

function blocosRebaixados(movimentos, membroPorIdFivem, agora) {
  const corte = agora - REBAIXADOS_DIAS * DIA_MS;
  const grupos = new Map();
  for (const m of movimentos.filter(x => x.acao === 'rebaixou_cargo' && new Date(x.ocorrido_em) >= corte)) {
    const chave = m.ator_id_fivem ?? m.ator_nome ?? '?';
    if (!grupos.has(chave)) grupos.set(chave, { gestor: rotuloDePessoa(m.ator_nome, m.ator_id_fivem, membroPorIdFivem), itens: [] });
    grupos.get(chave).itens.push(m);
  }
  return [...grupos.values()]
    .sort((a, b) => b.itens.length - a.itens.length)
    .map(({ gestor, itens }) => {
      const linhas = itens
        .sort((a, b) => new Date(b.ocorrido_em) - new Date(a.ocorrido_em))
        .map(m => `↳ ${rotuloDePessoa(m.alvo_nome, m.alvo_id_fivem, membroPorIdFivem)} · <t:${seg(m.ocorrido_em)}:d> (<t:${seg(m.ocorrido_em)}:R>)`);
      return `**Gestor:** ${gestor} · ${itens.length}\n${linhas.join('\n')}`;
    });
}

// Junta blocos em descrições que cabem num embed (um gestor nunca se parte no meio).
function paginar(blocos) {
  const paginas = [];
  let atual = '';
  for (const b of blocos) {
    if (atual && atual.length + b.length + 2 > LIMITE_EMBED) { paginas.push(atual); atual = ''; }
    atual += (atual ? '\n\n' : '') + b;
  }
  if (atual) paginas.push(atual);
  return paginas;
}

function embedsDaSecao({ titulo, blocos, vazio, rodape, cabecalho = null }) {
  const paginas = paginar(blocos);
  const agora = new Date().toISOString();
  if (!paginas.length) return [{ color: tema.cor.primaria, title: tema.titulo(titulo), description: `*${vazio}*`, footer: { text: rodape }, timestamp: agora }];
  return paginas.map((descricao, i) => ({
    color: tema.cor.primaria,
    title: i === 0 ? tema.titulo(titulo) : null,
    description: i === 0 && cabecalho ? `${cabecalho}\n\n${descricao}` : descricao,
    footer: { text: rodape + (paginas.length > 1 ? ` · Página ${i + 1}/${paginas.length}` : '') },
    timestamp: agora,
  }));
}

// Pura: entra o retrato já coletado, saem os embeds.
function embedsDeGestores({ recrutadores, movimentos, meta, membroPorIdFivem, agora = new Date() }) {
  const total = recrutadores.reduce((s, r) => s + r.rec30, 0);
  const cabecalho = `**Recrutadores ativos:** ${recrutadores.length} · **Recrutamentos em ${JANELA_DIAS}d:** ${total} · **Meta:** ${meta || '—'}/semana por recrutador\n-# Só quem tem o cargo hoje. Média semanal ignora a 1ª semana de cargo (carência).`;
  const rebaixados = blocosRebaixados(movimentos, membroPorIdFivem, agora);
  return [
    ...embedsDaSecao({
      titulo: '🧭 GESTORES E SEUS RECRUTADORES', cabecalho, blocos: blocosDosTimes(recrutadores, meta, membroPorIdFivem, agora),
      vazio: 'Nenhum recrutador com o cargo.', rodape: 'Avaliação do time · logs do jogo, fichas e advertências',
    }),
    ...embedsDaSecao({
      titulo: `⬇️ REBAIXADOS DE RECRUTADOR PARA SÓCIO (${REBAIXADOS_DIAS} DIAS)`, blocos: rebaixados,
      vazio: `Nenhum rebaixamento nos últimos ${REBAIXADOS_DIAS} dias.`, rodape: `TOTAL: ${rebaixados.length ? movimentos.filter(m => m.acao === 'rebaixou_cargo' && new Date(m.ocorrido_em) >= agora - REBAIXADOS_DIAS * DIA_MS).length : 0} REBAIXADOS · logs do jogo`,
    }),
  ];
}

// ── Coleta (Discord, logs, fichas, advertências) ─────────────────────────────

async function aprovadasPorRecrutador(desde) {
  try {
    const res = await db.query(
      `SELECT decidido_por_id AS discord_id, count(*)::int AS total FROM fichas_recrutamento
        WHERE status = 'APROVADO' AND decidido_em >= $1 AND decidido_por_id IS NOT NULL GROUP BY decidido_por_id`,
      [desde]
    );
    return new Map(res.rows.map(r => [r.discord_id, r.total]));
  } catch (err) {
    console.error('[quadroGestores] Erro ao ler fichas aprovadas:', err.message);
    return new Map();
  }
}

// Advertência ativa (tabela do módulo de advertência automática, se ligado) ou cargo ADV.
async function advertenciasPorRecrutador() {
  const porId = new Map();
  try {
    for (const a of await require('../advertenciaRecrutadorAuto/repositorio').ativas()) {
      porId.set(a.discord_id, (porId.get(a.discord_id) ?? 0) + 1);
    }
  } catch { /* módulo desligado: só o cargo conta */ }
  return porId;
}

function nivelPeloCargo(membro) {
  const cargos = config.cargos.advRec;
  if (!Array.isArray(cargos) || cargos.length !== 3) return 0;
  const i = cargos.findIndex(id => id && membro?.roles.cache.has(id));
  return i === -1 ? 0 : i + 1;
}

async function coletarRetrato(guild, agora = new Date()) {
  const { recrutadoresDoPeriodo } = require('../logsJogo/painelRecrutadoresInteracoes');
  const { lerMeta } = require('../logsJogo/inteligenciaRecrutadores');
  const periodo = dias => ({ chave: `${dias}d`, rotulo: `ÚLTIMOS ${dias} DIAS`, inicio: new Date(agora - dias * DIA_MS), fim: agora });
  const desde = new Date(agora - JANELA_DIAS * DIA_MS);

  const [l30, l7, movimentos, aprovadas, advertencias, meta] = await Promise.all([
    recrutadoresDoPeriodo(guild, periodo(JANELA_DIAS), agora), recrutadoresDoPeriodo(guild, periodo(SEMANA_DIAS), agora),
    repoLogs.movimentosDeRecrutador(), aprovadasPorRecrutador(desde), advertenciasPorRecrutador(), lerMeta(),
  ]);

  const membroPorIdFivem = new Map();
  for (const m of guild.members.cache.values()) {
    const id = E.idFivemDoNick(m.nickname ?? m.displayName);
    if (id) membroPorIdFivem.set(id, m);
  }
  const rec7 = new Map(l7.map(l => [l.discordId, l.recrutamentos]));
  const promocaoPorId = new Map(movimentos.filter(m => m.acao === 'promoveu_cargo').map(m => [m.alvo_id_fivem, m]));

  const recrutadores = l30.map(l => {
    const promocao = l.idFivem ? promocaoPorId.get(l.idFivem) : null;
    const membro = guild.members.cache.get(l.discordId);
    return {
      discordId: l.discordId, idFivem: l.idFivem, nome: l.nome,
      promovidoEm: promocao?.ocorrido_em ?? null,
      gestorChave: promocao ? (promocao.ator_id_fivem ?? promocao.ator_nome ?? '?') : null,
      gestor: promocao ? { nome: promocao.ator_nome, idFivem: promocao.ator_id_fivem } : null,
      rec7: rec7.get(l.discordId) ?? 0, rec30: l.recrutamentos, saiuCedo30: l.saiuCedo,
      porSemana: mediaSemanal(l.recrutamentos, promocao?.ocorrido_em, agora),
      aprovadas30: aprovadas.get(l.discordId) ?? 0,
      advNivel: Math.max(advertencias.get(l.discordId) ?? 0, nivelPeloCargo(membro)),
    };
  });
  return { recrutadores, movimentos, meta, membroPorIdFivem, agora };
}

async function montarEmbedsGestores(guild, agora = new Date()) {
  return embedsDeGestores(await coletarRetrato(guild, agora));
}

module.exports = { montarEmbedsGestores, embedsDeGestores, avaliarTime, mediaSemanal };
