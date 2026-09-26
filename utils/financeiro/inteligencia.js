const db = require('../db');

// Livro-caixa: receita e despesa dos últimos 30 dias contra os 30 anteriores, por categoria
async function balanco() {
  const { rows } = await db.query(
    `SELECT categoria,
            COALESCE(SUM(valor) FILTER (WHERE tipo = 'RECEITA' AND data >= current_date - 30), 0)::float AS receita,
            COALESCE(SUM(valor) FILTER (WHERE tipo = 'DESPESA' AND data >= current_date - 30), 0)::float AS despesa,
            COALESCE(SUM(valor) FILTER (WHERE tipo = 'RECEITA' AND data < current_date - 30), 0)::float AS receita_ant,
            COALESCE(SUM(valor) FILTER (WHERE tipo = 'DESPESA' AND data < current_date - 30), 0)::float AS despesa_ant
       FROM financeiro_lancamentos WHERE data >= current_date - 60 GROUP BY categoria ORDER BY categoria`
  );
  return rows;
}

module.exports = { balanco };
