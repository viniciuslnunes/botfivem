const db = require('../db');

function montarFiltro(f = {}) {
  const cond = [];
  const params = [];
  const p = v => { params.push(v); return `$${params.length}`; };
  if (f.inicio) cond.push(`data >= ${p(f.inicio)}::date`);
  if (f.fim) cond.push(`data <= ${p(f.fim)}::date`);
  if (f.tipo) cond.push(`tipo = ${p(f.tipo)}`);
  if (f.categoria) cond.push(`categoria = ${p(f.categoria)}`);
  if (f.eventoId) cond.push(`evento_id = ${p(f.eventoId)}`);
  return { where: cond.length ? `WHERE ${cond.join(' AND ')}` : '', params };
}

// Automático (origem + origem_id) nunca duplica: repetir a chamada devolve null
async function lancar(l, conexao = db) {
  const { rows } = await conexao.query(
    `INSERT INTO financeiro_lancamentos
       (tipo, categoria, valor, descricao, data, evento_id, area_slug, origem, origem_id, criado_por_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (origem, origem_id) WHERE origem_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [l.tipo, l.categoria, l.valor, l.descricao, l.data, l.eventoId ?? null, l.areaSlug ?? null,
      l.origem ?? 'MANUAL', l.origemId ?? null, l.criadoPorId]
  );
  return rows[0] ?? null;
}

async function listarLancamentos(filtro, limite = 25) {
  const { where, params } = montarFiltro(filtro);
  const { rows } = await db.query(
    `SELECT * FROM financeiro_lancamentos ${where} ORDER BY data DESC, id DESC LIMIT ${Number(limite)}`, params);
  return rows;
}

async function totaisPorCategoria(filtro) {
  const { where, params } = montarFiltro(filtro);
  const { rows } = await db.query(
    `SELECT tipo, categoria, SUM(valor)::float AS total, COUNT(*)::int AS lancamentos
       FROM financeiro_lancamentos ${where} GROUP BY tipo, categoria`, params);
  return rows;
}

async function excluirManual(id) {
  const { rows } = await db.query(
    "DELETE FROM financeiro_lancamentos WHERE id = $1 AND origem = 'MANUAL' RETURNING *", [id]);
  return rows[0] ?? null;
}

async function buscarLancamento(id) {
  const { rows } = await db.query('SELECT * FROM financeiro_lancamentos WHERE id = $1', [id]);
  return rows[0] ?? null;
}

module.exports = { lancar, listarLancamentos, totaisPorCategoria, excluirManual, buscarLancamento };
