const db = require('../db');

// Carteirinhas que vencem nos próximos dias (ou venceram há pouco): a hora certa de olhar para quem
// está saindo. Vencida há mais de 3 dias é outro assunto (renovação esquecida), não um risco novo.
async function vencendo(dias = 7) {
  const hoje = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";
  const { rows } = await db.query(
    `SELECT discord_id, numero_socio, validade FROM socios
      WHERE revogada_em IS NULL AND validade::date BETWEEN ${hoje} - 3 AND ${hoje} + $1::int
      ORDER BY validade`,
    [dias]
  );
  return rows;
}

module.exports = { vencendo };
