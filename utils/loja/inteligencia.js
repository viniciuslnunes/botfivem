const db = require('../db');

// Atendimento da loja: pedidos parados e tempo até a equipe decidir
async function atendimento(dias = 60) {
  const { rows } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'PENDENTE')::int AS pendentes,
            COUNT(*) FILTER (WHERE status = 'PENDENTE' AND criado_em < now() - interval '24 hours')::int AS parados,
            COUNT(*) FILTER (WHERE status = 'CONFIRMADO')::int AS confirmados,
            COUNT(*) FILTER (WHERE status = 'CANCELADO')::int AS cancelados,
            AVG(EXTRACT(EPOCH FROM (decidido_em - criado_em))) FILTER (WHERE decidido_em IS NOT NULL)::float AS decisao_seg
       FROM loja_pedidos WHERE criado_em >= now() - ($1 || ' days')::interval`,
    [String(dias)]
  );
  return rows[0];
}

module.exports = { atendimento };
