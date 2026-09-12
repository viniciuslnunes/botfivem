const db = require('../db');

// Ledger append-only: a mesma origem nunca pontua duas vezes
async function registrarEvento({ discordId, sinal, peso, origemTipo, origemId }) {
  const { rows } = await db.query(
    `INSERT INTO confianca_eventos (discord_id, sinal, peso, origem_tipo, origem_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (sinal, origem_tipo, origem_id, discord_id) DO NOTHING RETURNING *`,
    [discordId, sinal, peso, origemTipo, origemId]
  );
  return rows[0] ?? null;
}

async function listarEventos(discordId) {
  const { rows } = await db.query(
    'SELECT sinal, peso, origem_tipo, origem_id, criado_em FROM confianca_eventos WHERE discord_id = $1 ORDER BY criado_em DESC',
    [discordId]
  );
  return rows;
}

module.exports = { registrarEvento, listarEventos };
