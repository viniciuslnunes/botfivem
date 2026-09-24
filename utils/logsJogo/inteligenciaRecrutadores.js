const E = require('./estatisticas');
const repo = require('./repositorio');
const { lerConfig, gravarConfig } = require('../botConfig');

// Cruzamentos do 🦅・painel-recrutadores que vão além de "quantos recrutou":
// quando foi o último recrutamento, tendência, meta semanal, qualidade de quem
// foi recrutado (ADV/blacklist/impedimento depois; nunca mais jogou) e os
// horários em que recruta × joga. Tudo sai dos logs do jogo (logs_jogo) e do
// bot_config. O que depende de OUTRO módulo (advertência, manto, fichas)
// entra por `registrarEnriquecedor` — o módulo que tem os dados se pluga; com
// ele desligado o painel simplesmente não mostra essas colunas.
const DIA_MS = E.DIA_MS;

// Ocorrências que contam como "recrutado deu problema" (ver regras-negocio.md).
// Expulsão/saída não entram: já compõem a retenção.
const ACOES_PROBLEMA = ['advertido', 'blacklist_adicionou', 'impedimento_adicionou', 'suspensao_adicionou'];
const JANELA_PROBLEMA_DIAS = 30;
// Recrutado com mais que isso e nenhum log depois do recrutamento = "fantasma".
const FANTASMA_DIAS = 7;
// Só sinaliza atenção com amostra mínima (1–2 casos é ruído, igual à retenção).
const MIN_CASOS_ATENCAO = 3;

const META_CHAVE = 'recrutadores_meta_semanal';
const META_PADRAO = 5; // recrutamentos por semana; 0 desliga a meta

async function lerMeta() {
  try {
    const bruto = await lerConfig(META_CHAVE);
    const n = bruto === null ? META_PADRAO : Number(bruto);
    return Number.isInteger(n) && n >= 0 ? n : META_PADRAO;
  } catch {
    return META_PADRAO;
  }
}

async function gravarMeta(valor) {
  await gravarConfig(META_CHAVE, String(valor));
}

// ── Formatação (pura) ────────────────────────────────────────────────────────

// "há quanto tempo" curto pra célula de tabela: 25min, 3h, 2d, 99d+.
function tempoDesde(data, agora = new Date()) {
  if (!data) return '—';
  const ms = Math.max(0, agora - new Date(data));
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `${horas}h`;
  const dias = Math.floor(horas / 24);
  return dias > 99 ? '99d+' : `${dias}d`;
}

// Última atividade no jogo: "agora" se online, senão há quanto tempo saiu.
function celulaOnline(l, agora = new Date()) {
  if (!l.idFivem) return '—';
  if (l.online) return 'agora';
  return tempoDesde(l.ultimaConexao?.em, agora);
}

function celulaTendencia(atual, anterior) {
  if (anterior === null || anterior === undefined) return '—';
  const delta = atual - anterior;
  if (delta > 0) return `▲${delta}`;
  if (delta < 0) return `▼${-delta}`;
  return '=';
}

function celulaMeta(rec7, meta) {
  if (!meta) return '—';
  return `${Math.round((rec7 / meta) * 100)}%`;
}

function celulaFracao(parte, total) {
  return total ? `${parte}/${total}` : '—';
}

// Horas (0–23) mais frequentes, em ordem do dia: "20h (12) · 21h (9)".
function horasPico(linhasHora, quantas = 3) {
  return [...linhasHora]
    .filter(h => h.total > 0)
    .sort((a, b) => b.total - a.total || a.hora - b.hora)
    .slice(0, quantas)
    .sort((a, b) => a.hora - b.hora)
    .map(h => `${String(h.hora).padStart(2, '0')}h (${h.total})`);
}

// Horas em que entra no jogo (≥ `minimo` entradas) e nunca recrutou.
function horasSemRecrutar(entradasPorHora, recrutouPorHora, minimo = 3, quantas = 3) {
  const recrutou = new Set(recrutouPorHora.filter(h => h.total > 0).map(h => h.hora));
  return entradasPorHora
    .filter(h => h.total >= minimo && !recrutou.has(h.hora))
    .sort((a, b) => b.total - a.total || a.hora - b.hora)
    .slice(0, quantas)
    .sort((a, b) => a.hora - b.hora)
    .map(h => `${String(h.hora).padStart(2, '0')}h (${h.total} entradas)`);
}

// ── Enriquecimento ───────────────────────────────────────────────────────────

const enriquecedores = [];
// fn(linhas, periodo, agora): acrescenta campos às linhas (e textos em `atencao`).
function registrarEnriquecedor(fn) {
  if (!enriquecedores.includes(fn)) enriquecedores.push(fn);
}

function contarPorRecrutador(linhas) {
  const mapa = new Map();
  for (const l of linhas) {
    if (!mapa.has(l.recrutador)) mapa.set(l.recrutador, new Set());
    mapa.get(l.recrutador).add(l.alvo);
  }
  return mapa;
}

function baseVazia() {
  return {
    ultimoRecrutou: null, anterior: null, rec7: 0, meta: META_PADRAO,
    problemas: 0, fantasmas: 0, maduros: 0, atencao: [],
  };
}

// Acrescenta a cada linha (mutando) os campos de inteligência. Falha em qualquer
// consulta é logada e o painel segue só com os dados básicos.
async function enriquecerRecrutadores(linhas, periodo, agora = new Date()) {
  for (const l of linhas) Object.assign(l, baseVazia());
  try {
    const ids = [...new Set(linhas.filter(l => l.idFivem).map(l => l.idFivem))];
    if (ids.length) {
      const semana = { inicio: new Date(agora.getTime() - 7 * DIA_MS), fim: agora };
      const anterior = periodo.anteriorInicio ? { inicio: periodo.anteriorInicio, fim: periodo.anteriorFim } : null;
      const [meta, ultimas, contSemana, contAnterior, detalhe] = await Promise.all([
        lerMeta(),
        repo.ultimaPorAtorNaLista(['jogador_recrutou'], ids),
        repo.contarPorAtorNaLista(['jogador_recrutou'], ids, semana),
        anterior ? repo.contarPorAtorNaLista(['jogador_recrutou'], ids, anterior) : [],
        repo.recrutamentosDetalhados(ids, periodo),
      ]);
      const pares = detalhe.map(r => ({ recrutador: r.recrutador, alvo: r.recrutado, em: r.ocorrido_em }));
      const limiteMaduro = agora.getTime() - FANTASMA_DIAS * DIA_MS;
      const maduros = pares.filter(p => new Date(p.em).getTime() <= limiteMaduro);
      const [comProblema, semAtividade] = await Promise.all([
        repo.recrutadosComOcorrenciaDepois(pares, ACOES_PROBLEMA, JANELA_PROBLEMA_DIAS),
        repo.recrutadosSemAtividadeDepois(maduros),
      ]);
      const ultimaPorId = new Map(ultimas.map(r => [r.id, r.ultima]));
      const semanaPorId = new Map(contSemana.map(r => [r.id, r.total]));
      const anteriorPorId = new Map(contAnterior.map(r => [r.id, r.total]));
      const problemaPorId = contarPorRecrutador(comProblema);
      const fantasmaPorId = contarPorRecrutador(semAtividade);
      const madurosPorId = contarPorRecrutador(maduros);

      for (const l of linhas) {
        if (!l.idFivem) continue;
        l.meta = meta;
        l.ultimoRecrutou = ultimaPorId.get(l.idFivem) ?? null;
        l.rec7 = semanaPorId.get(l.idFivem) ?? 0;
        l.anterior = anterior ? (anteriorPorId.get(l.idFivem) ?? 0) : null;
        l.problemas = problemaPorId.get(l.idFivem)?.size ?? 0;
        l.fantasmas = fantasmaPorId.get(l.idFivem)?.size ?? 0;
        l.maduros = madurosPorId.get(l.idFivem)?.size ?? 0;
        if (l.problemas >= MIN_CASOS_ATENCAO) {
          l.atencao.push(`${l.problemas} de ${l.recrutamentos} recrutados tiveram advertência, blacklist ou impedimento em até ${JANELA_PROBLEMA_DIAS} dias.`);
        }
        if (l.fantasmas >= MIN_CASOS_ATENCAO && l.fantasmas / l.maduros >= 0.5) {
          l.atencao.push(`${l.fantasmas} de ${l.maduros} recrutados nunca mais apareceram no jogo (${FANTASMA_DIAS}+ dias).`);
        }
      }
    }
  } catch (err) {
    console.error('[painel-recrutadores] Erro ao cruzar dados extras:', err);
  }
  for (const fn of enriquecedores) {
    try {
      await fn(linhas, periodo, agora);
    } catch (err) {
      console.error('[painel-recrutadores] Enriquecedor falhou:', err);
    }
  }
  return linhas;
}

// Horários (fuso de SP, últimos 60 dias) em que UM recrutador recruta e entra
// no jogo — para a ficha.
async function horariosDoRecrutador(idFivem) {
  const [recruta, entra] = await Promise.all([
    repo.horasDoAtor(idFivem, ['jogador_recrutou'], 60),
    repo.horasDoAtor(idFivem, ['jogador_entrou'], 60),
  ]);
  return { recruta, entra };
}

module.exports = {
  ACOES_PROBLEMA, JANELA_PROBLEMA_DIAS, FANTASMA_DIAS, MIN_CASOS_ATENCAO, META_PADRAO,
  lerMeta, gravarMeta,
  tempoDesde, celulaOnline, celulaTendencia, celulaMeta, celulaFracao, horasPico, horasSemRecrutar,
  registrarEnriquecedor, enriquecerRecrutadores, horariosDoRecrutador,
};
