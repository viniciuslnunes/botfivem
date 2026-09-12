const db = require('../db');

async function criarFato(f) {
  const { rows } = await db.query(
    `INSERT INTO memoria_fatos (dia, autor_id, texto, midia_ref, evento_id, status)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [f.dia, f.autorId, f.texto, f.midiaRef, f.eventoId, f.status]
  );
  return rows[0];
}

async function buscarFato(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const { rows } = await db.query("SELECT *, to_char(dia, 'YYYY-MM-DD') AS dia_chave FROM memoria_fatos WHERE id = $1", [id]);
  return rows[0] ?? null;
}

// Decide só o que ainda está pendente (dois moderadores não decidem o mesmo fato)
async function decidirFato(id, status, porId, motivo = null) {
  const { rows } = await db.query(
    `UPDATE memoria_fatos SET status = $2, decidido_por_id = $3, decidido_em = now(), motivo = $4
      WHERE id = $1 AND status = 'PENDENTE'
      RETURNING *, to_char(dia, 'YYYY-MM-DD') AS dia_chave`,
    [id, status, porId, motivo]
  );
  return rows[0] ?? null;
}

async function gravarPublicacao(id, mensagemUrl) {
  await db.query('UPDATE memoria_fatos SET publicado_url = $2 WHERE id = $1', [id, mensagemUrl]);
}

async function threadDoDia(dia) {
  const { rows } = await db.query('SELECT thread_id FROM memoria_dias WHERE dia = $1', [dia]);
  return rows[0]?.thread_id ?? null;
}

async function gravarThreadDoDia(dia, threadId) {
  await db.query(
    'INSERT INTO memoria_dias (dia, thread_id) VALUES ($1, $2) ON CONFLICT (dia) DO UPDATE SET thread_id = $2',
    [dia, threadId]
  );
}

async function fatosDoDia(dia) {
  const { rows } = await db.query(
    "SELECT * FROM memoria_fatos WHERE dia = $1 AND status = 'APROVADA' ORDER BY criado_em", [dia]);
  return rows;
}

module.exports = { criarFato, buscarFato, decidirFato, gravarPublicacao, threadDoDia, gravarThreadDoDia, fatosDoDia };
