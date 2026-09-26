const db = require('../db');

// Empréstimos abertos há muito tempo: a peça saiu do patrimônio e não voltou
async function emprestimosAtrasados(dias = 7) {
  const { rows } = await db.query(
    `SELECT e.id, e.discord_id, e.saiu_em, i.nome, i.categoria
       FROM patrimonio_emprestimos e JOIN patrimonio_itens i ON i.id = e.item_id
      WHERE e.status = 'ABERTO' AND e.saiu_em < now() - ($1 || ' days')::interval
      ORDER BY e.saiu_em`,
    [String(dias)]
  );
  return rows;
}

module.exports = { emprestimosAtrasados };
