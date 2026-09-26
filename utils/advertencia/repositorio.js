const db = require('../db');

// Advertências de sócio nascidas do painel do jogo (a manual continua só em cargo).
async function inserir(a) {
  const res = await db.query(
    `INSERT INTO advertencias_socio
       (discord_id, id_fivem, nivel, origem, motivo, registrado_por, log_message_id, prazo_em, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (log_message_id, origem) DO NOTHING
     RETURNING *`,
    [a.discordId, a.idFivem, a.nivel, a.origem, a.motivo, a.registradoPor ?? null, a.logMessageId, a.prazoEm ?? null, a.status ?? 'ATIVA']
  );
  return res.rows[0] ?? null;
}

async function recentePorMembro(discordId, desde) {
  const res = await db.query(
    'SELECT 1 FROM advertencias_socio WHERE discord_id = $1 AND criada_em >= $2 LIMIT 1',
    [discordId, desde]
  );
  return res.rows.length > 0;
}

async function ativaPorIdFivem(idFivem, origem) {
  const res = await db.query(
    `SELECT * FROM advertencias_socio
      WHERE id_fivem = $1 AND origem = $2 AND status = 'ATIVA'
      ORDER BY criada_em DESC LIMIT 1`,
    [idFivem, origem]
  );
  return res.rows[0] ?? null;
}

async function pendentesDePagamento(idFivem) {
  const res = await db.query(
    `SELECT * FROM advertencias_socio
      WHERE id_fivem = $1 AND nivel = 2 AND status = 'ATIVA' AND prazo_em IS NOT NULL
      ORDER BY criada_em`,
    [idFivem]
  );
  return res.rows;
}

// Pagamentos pendentes de um sócio (por Discord) ou de todos (sem argumento)
async function pendentes(discordId = null) {
  const res = await db.query(
    `SELECT * FROM advertencias_socio
      WHERE nivel = 2 AND status = 'ATIVA' AND prazo_em IS NOT NULL AND ($1::text IS NULL OR discord_id = $1)
      ORDER BY prazo_em`,
    [discordId]
  );
  return res.rows;
}

async function gravarPagamento(id, pago) {
  await db.query('UPDATE advertencias_socio SET pago = $2 WHERE id = $1', [id, pago]);
}

// Só sai de ATIVA uma vez: a segunda chamada devolve null (nada a fazer)
async function encerrar(id, status, resolucao) {
  const res = await db.query(
    `UPDATE advertencias_socio SET status = $2, resolucao = $3, resolvida_em = now()
      WHERE id = $1 AND status = 'ATIVA' RETURNING *`,
    [id, status, resolucao ?? null]
  );
  return res.rows[0] ?? null;
}

async function historicoDoMembro(discordId) {
  const res = await db.query(
    'SELECT * FROM advertencias_socio WHERE discord_id = $1 ORDER BY criada_em DESC',
    [discordId]
  );
  return res.rows;
}

module.exports = { inserir, recentePorMembro, ativaPorIdFivem, pendentesDePagamento, pendentes, gravarPagamento, encerrar, historicoDoMembro };
