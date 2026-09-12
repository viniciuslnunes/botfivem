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

const ACOES_CONEXAO = ['jogador_entrou', 'jogador_saiu'];

// Último evento de entrada/saída de cada jogador antes de `instante` (padrão:
// agora) — é o estado de presença: entrou = online, saiu = offline.
async function estadoDosJogadores(instante = new Date()) {
  const res = await db.query(
    `SELECT DISTINCT ON (ator_id_fivem) ator_id_fivem AS id, ator_nome AS nome, acao, ocorrido_em
       FROM logs_jogo
      WHERE acao = ANY($1) AND ator_id_fivem IS NOT NULL AND ocorrido_em < $2
      ORDER BY ator_id_fivem, ocorrido_em DESC`,
    [ACOES_CONEXAO, instante]
  );
  return res.rows;
}

// Eventos de entrada/saída em ordem cronológica, para reconstruir a linha do
// tempo de simultâneos dentro do período.
async function eventosConexao(inicio, fim) {
  const res = await db.query(
    `SELECT ator_id_fivem AS id, ator_nome AS nome, acao, ocorrido_em
       FROM logs_jogo
      WHERE acao = ANY($1) AND ator_id_fivem IS NOT NULL AND ocorrido_em >= $2 AND ocorrido_em < $3
      ORDER BY ocorrido_em ASC`,
    [ACOES_CONEXAO, inicio, fim]
  );
  return res.rows;
}

async function jogadoresDistintosNoPeriodo(inicio, fim) {
  const res = await db.query(
    `SELECT COUNT(DISTINCT ator_id_fivem)::int AS total
       FROM logs_jogo
      WHERE acao = ANY($1) AND ator_id_fivem IS NOT NULL AND ocorrido_em >= $2 AND ocorrido_em < $3`,
    [ACOES_CONEXAO, inicio, fim]
  );
  return res.rows[0].total;
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
  jogadoresDistintosNoPeriodo,
};
