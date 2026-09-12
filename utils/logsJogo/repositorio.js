const db = require('../db');

// Acesso ao banco dos logs do jogo. Colunas e ordenações são fixas aqui:
// nada vindo do usuário entra no SQL fora dos parâmetros.

function escaparLike(texto) {
  return String(texto).replace(/[\\%_]/g, c => `\\${c}`);
}

function montarFiltro(filtro = {}) {
  const condicoes = [];
  const params = [];
  const p = valor => {
    params.push(valor);
    return `$${params.length}`;
  };
  if (filtro.inicio) condicoes.push(`ocorrido_em >= ${p(filtro.inicio)}`);
  if (filtro.fim) condicoes.push(`ocorrido_em < ${p(filtro.fim)}`);
  if (filtro.idFivem) {
    const id = p(filtro.idFivem);
    condicoes.push(`(ator_id_fivem = ${id} OR alvo_id_fivem = ${id})`);
  }
  if (filtro.categoria) condicoes.push(`categoria = ${p(filtro.categoria)}`);
  if (filtro.acao) condicoes.push(`acao = ${p(filtro.acao)}`);
  if (filtro.texto) {
    const t = p(`%${escaparLike(filtro.texto)}%`);
    condicoes.push(`(descricao ILIKE ${t} OR titulo ILIKE ${t} OR ator_nome ILIKE ${t} OR alvo_nome ILIKE ${t})`);
  }
  return { condicoes, params };
}

function where(condicoes) {
  return condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
}

async function inserirRegistro(r) {
  const res = await db.query(
    `INSERT INTO logs_jogo
       (message_id, embed_indice, canal_id, categoria, acao, ator_nome, ator_id_fivem,
        alvo_nome, alvo_id_fivem, valor, titulo, descricao, ocorrido_em, bruto)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (message_id, embed_indice) DO NOTHING
     RETURNING id`,
    [r.messageId, r.embedIndice, r.canalId, r.categoria, r.acao, r.atorNome, r.atorIdFivem,
      r.alvoNome, r.alvoIdFivem, r.valor, r.titulo, r.descricao, r.ocorridoEm, r.bruto]
  );
  return res.rowCount > 0;
}

async function idsJaGravados(messageIds) {
  if (!messageIds.length) return new Set();
  const res = await db.query('SELECT DISTINCT message_id FROM logs_jogo WHERE message_id = ANY($1)', [messageIds]);
  return new Set(res.rows.map(r => r.message_id));
}

async function buscarLogs(filtro, pagina, porPagina) {
  const { condicoes, params } = montarFiltro(filtro);
  const totalRes = await db.query(`SELECT COUNT(*)::int AS total FROM logs_jogo ${where(condicoes)}`, params);
  const total = totalRes.rows[0].total;
  const ultimaPagina = Math.max(0, Math.ceil(total / porPagina) - 1);
  const paginaEfetiva = Math.min(Math.max(0, pagina), ultimaPagina);
  const itens = await db.query(
    `SELECT id, categoria, acao, ator_nome, ator_id_fivem, alvo_nome, alvo_id_fivem, valor, descricao, ocorrido_em
       FROM logs_jogo ${where(condicoes)}
      ORDER BY ocorrido_em DESC, id DESC
      LIMIT ${Number(porPagina)} OFFSET ${paginaEfetiva * Number(porPagina)}`,
    params
  );
  return { total, pagina: paginaEfetiva, itens: itens.rows };
}

async function resumo(filtro) {
  const { condicoes, params } = montarFiltro(filtro);
  const res = await db.query(
    `SELECT COUNT(*)::int AS total,
            COALESCE(SUM(valor), 0)::float AS valor_total,
            COUNT(DISTINCT COALESCE(ator_id_fivem, ator_nome))::int AS pessoas,
            MIN(ocorrido_em) AS primeira_em,
            MAX(ocorrido_em) AS ultima_em
       FROM logs_jogo ${where(condicoes)}`,
    params
  );
  return res.rows[0];
}

async function contarPorDia(filtro) {
  const { condicoes, params } = montarFiltro(filtro);
  const res = await db.query(
    `SELECT to_char(ocorrido_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dia, COUNT(*)::int AS total
       FROM logs_jogo ${where(condicoes)}
      GROUP BY 1 ORDER BY 1`,
    params
  );
  return res.rows;
}

const COLUNAS_TOP = { categoria: 'categoria', acao: 'acao' };

async function topPorColuna(coluna, filtro, limite) {
  const expr = COLUNAS_TOP[coluna];
  if (!expr) throw new Error(`Coluna de ranking não permitida: ${coluna}`);
  const { condicoes, params } = montarFiltro(filtro);
  const res = await db.query(
    `SELECT ${expr} AS chave, COUNT(*)::int AS total
       FROM logs_jogo ${where([...condicoes, `${expr} IS NOT NULL`])}
      GROUP BY 1 ORDER BY total DESC LIMIT ${Number(limite)}`,
    params
  );
  return res.rows;
}

async function topAtores(filtro, limite) {
  const { condicoes, params } = montarFiltro(filtro);
  const res = await db.query(
    `SELECT MAX(ator_id_fivem) AS id, MAX(ator_nome) AS nome, COUNT(*)::int AS total
       FROM logs_jogo ${where([...condicoes, '(ator_id_fivem IS NOT NULL OR ator_nome IS NOT NULL)'])}
      GROUP BY COALESCE(ator_id_fivem, ator_nome)
      ORDER BY total DESC LIMIT ${Number(limite)}`,
    params
  );
  return res.rows;
}

async function valoresDistintos(coluna, prefixo) {
  const expr = COLUNAS_TOP[coluna];
  if (!expr) throw new Error(`Coluna não permitida: ${coluna}`);
  const res = await db.query(
    `SELECT ${expr} AS valor FROM logs_jogo
      WHERE ${expr} IS NOT NULL AND ${expr} ILIKE $1
      GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 25`,
    [`${escaparLike(prefixo)}%`]
  );
  return res.rows.map(r => r.valor);
}

async function ultimaAtividadePorIds(ids) {
  if (!ids.length) return new Map();
  const res = await db.query(
    `SELECT id, MAX(ocorrido_em) AS ultima FROM (
       SELECT ator_id_fivem AS id, ocorrido_em FROM logs_jogo WHERE ator_id_fivem = ANY($1)
       UNION ALL
       SELECT alvo_id_fivem AS id, ocorrido_em FROM logs_jogo WHERE alvo_id_fivem = ANY($1)
     ) t GROUP BY id`,
    [ids]
  );
  return new Map(res.rows.map(r => [r.id, r.ultima]));
}

// Condições comuns a topAtoresPorAcoes/contarPorAcoes/listarPorAcoes: um
// conjunto de ações (não uma só, como montarFiltro) + período opcional. Essas
// três consultas reaproveitam a lideranca ativa, o histórico de carreira e as
// saídas da torcida — todas "algumas ações específicas, num período".
function condicoesPorAcoes(acoes, { inicio, fim } = {}) {
  const condicoes = ['acao = ANY($1)'];
  const params = [acoes];
  if (inicio) { params.push(inicio); condicoes.push(`ocorrido_em >= $${params.length}`); }
  if (fim) { params.push(fim); condicoes.push(`ocorrido_em < $${params.length}`); }
  return { condicoes, params };
}

// Ranking de quem mais AGIU (ator) entre um conjunto de ações — usado pela
// liderança ativa (convocação/patrimônio) e por "quem mais promoveu".
async function topAtoresPorAcoes(acoes, periodo, limite) {
  const { condicoes, params } = condicoesPorAcoes(acoes, periodo);
  condicoes.push('(ator_id_fivem IS NOT NULL OR ator_nome IS NOT NULL)');
  const res = await db.query(
    `SELECT MAX(ator_id_fivem) AS id, MAX(ator_nome) AS nome, COUNT(*)::int AS total
       FROM logs_jogo WHERE ${condicoes.join(' AND ')}
      GROUP BY COALESCE(ator_id_fivem, ator_nome)
      ORDER BY total DESC LIMIT ${Number(limite)}`,
    params
  );
  return res.rows;
}

// Quantidade por ação dentro de um conjunto — "quantas de cada tipo" (ex.:
// sede trancou vs destrancou, saiu vs foi expulso).
async function contarPorAcoes(acoes, periodo) {
  const { condicoes, params } = condicoesPorAcoes(acoes, periodo);
  const res = await db.query(
    `SELECT acao, COUNT(*)::int AS total FROM logs_jogo WHERE ${condicoes.join(' AND ')}
      GROUP BY acao ORDER BY total DESC`,
    params
  );
  return res.rows;
}

// Últimos eventos de um conjunto de ações, mais recentes primeiro — usado
// pela lista de "últimas saídas" em montarEmbedChurn.
async function listarPorAcoes(acoes, periodo, limite) {
  const { condicoes, params } = condicoesPorAcoes(acoes, periodo);
  const res = await db.query(
    `SELECT acao, ator_nome, ator_id_fivem, alvo_nome, alvo_id_fivem, descricao, ocorrido_em
       FROM logs_jogo WHERE ${condicoes.join(' AND ')}
      ORDER BY ocorrido_em DESC LIMIT ${Number(limite)}`,
    params
  );
  return res.rows;
}

// Trilha de promoções/rebaixamentos de UM sócio (é o alvo, não o ator), em
// ordem cronológica — "de > para" fica pra quem exibir extrair da
// `descricao` (ver E.extrairMudancaCargo), não vira coluna nova.
async function historicoCargo(idFivem) {
  const res = await db.query(
    `SELECT acao, ator_nome, alvo_nome, descricao, ocorrido_em
       FROM logs_jogo
      WHERE acao IN ('promoveu_cargo', 'rebaixou_cargo') AND alvo_id_fivem = $1
      ORDER BY ocorrido_em ASC`,
    [idFivem]
  );
  return res.rows;
}

// Último evento de qualquer uma das ações dadas — usado pro módulo de
// segurança descobrir o estado atual de uma fechadura (o último "trancou"/
// "destrancou" registrado, qual dos dois foi por último é que decide).
async function ultimoEvento(acoes) {
  const res = await db.query(
    `SELECT acao, ator_nome, ator_id_fivem, ocorrido_em
       FROM logs_jogo
      WHERE acao = ANY($1)
      ORDER BY ocorrido_em DESC, message_id::bigint DESC, embed_indice DESC
      LIMIT 1`,
    [acoes]
  );
  return res.rows[0] ?? null;
}

const ACOES_CONEXAO = ['jogador_entrou', 'jogador_saiu'];

// O webhook do jogo manda vários eventos JUNTOS num só embed do Discord (um
// "Entrada"/"Saída" por linha), e todos eles gravam o mesmo `ocorrido_em`
// (é a hora da MENSAGEM, não do evento em si — ver ingestao.js). Dentro
// dessa mensagem, `embed_indice` é a única coisa que preserva a ordem real
// dos eventos (a ordem em que o jogo mandou pro webhook); sem desempatar por
// ele, o Postgres pode devolver entrada/saída do mesmo jogador na mesma
// mensagem em qualquer ordem — inclusive invertida — o que confundiria uma
// saída-e-reconexão de verdade (`unificarReconexoesRapidas`) com uma sessão
// nova. `message_id` desempata entre mensagens diferentes que caiam no
// mesmíssimo milissegundo (raro, mas os snowflakes do Discord são
// cronológicos, então dá pra comparar como número).
async function estadoDosJogadores(instante = new Date()) {
  const res = await db.query(
    `SELECT DISTINCT ON (ator_id_fivem) ator_id_fivem AS id, ator_nome AS nome, acao, ocorrido_em
       FROM logs_jogo
      WHERE acao = ANY($1) AND ator_id_fivem IS NOT NULL AND ocorrido_em < $2
      ORDER BY ator_id_fivem, ocorrido_em DESC, message_id::bigint DESC, embed_indice DESC`,
    [ACOES_CONEXAO, instante]
  );
  return res.rows;
}

// Eventos de entrada/saída em ordem cronológica, para reconstruir a linha do
// tempo de simultâneos dentro do período. Ver o comentário de
// estadoDosJogadores sobre por que o desempate por message_id/embed_indice é
// necessário, não só um capricho de determinismo.
async function eventosConexao(inicio, fim) {
  const res = await db.query(
    `SELECT ator_id_fivem AS id, ator_nome AS nome, acao, ocorrido_em
       FROM logs_jogo
      WHERE acao = ANY($1) AND ator_id_fivem IS NOT NULL AND ocorrido_em >= $2 AND ocorrido_em < $3
      ORDER BY ocorrido_em ASC, message_id::bigint ASC, embed_indice ASC`,
    [ACOES_CONEXAO, inicio, fim]
  );
  return res.rows;
}

module.exports = {
  inserirRegistro,
  idsJaGravados,
  buscarLogs,
  resumo,
  contarPorDia,
  topCategorias: (filtro, limite) => topPorColuna('categoria', filtro, limite),
  topAcoes: (filtro, limite) => topPorColuna('acao', filtro, limite),
  topAtores,
  categoriasDistintas: prefixo => valoresDistintos('categoria', prefixo),
  acoesDistintas: prefixo => valoresDistintos('acao', prefixo),
  ultimaAtividadePorIds,
  estadoDosJogadores,
  eventosConexao,
  ultimoEvento,
  topAtoresPorAcoes,
  contarPorAcoes,
  listarPorAcoes,
  historicoCargo,
};
