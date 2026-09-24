const db = require('../db');
const { contarVotos } = require('./regras');

async function criarSugestao({ autorId, texto }) {
  const { rows } = await db.query('INSERT INTO sugestoes (autor_id, texto) VALUES ($1, $2) RETURNING *', [autorId, texto]);
  return rows[0];
}

async function gravarPublicacao(id, { mensagemId, threadId = null }) {
  await db.query('UPDATE sugestoes SET message_id = $2, thread_id = $3 WHERE id = $1', [id, mensagemId, threadId]);
}

async function apagarSugestao(id) {
  await db.query('DELETE FROM sugestoes WHERE id = $1', [id]);
}

async function buscarSugestao(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const { rows } = await db.query('SELECT * FROM sugestoes WHERE id = $1', [id]);
  return rows[0] ?? null;
}

async function contagem(id) {
  const { rows } = await db.query('SELECT voto, count(*)::int AS n FROM sugestoes_votos WHERE sugestao_id = $1 GROUP BY voto', [id]);
  return contarVotos(rows);
}

// Um voto por pessoa: repetir o mesmo voto retira, o outro troca.
async function votar(id, discordId, voto) {
  const { rows } = await db.query('SELECT voto FROM sugestoes_votos WHERE sugestao_id = $1 AND discord_id = $2', [id, discordId]);
  if (rows[0]?.voto === voto) {
    await db.query('DELETE FROM sugestoes_votos WHERE sugestao_id = $1 AND discord_id = $2', [id, discordId]);
  } else {
    await db.query(
      `INSERT INTO sugestoes_votos (sugestao_id, discord_id, voto) VALUES ($1, $2, $3)
       ON CONFLICT (sugestao_id, discord_id) DO UPDATE SET voto = $3, votado_em = now()`,
      [id, discordId, voto]
    );
  }
  return contagem(id);
}

module.exports = { criarSugestao, gravarPublicacao, apagarSugestao, buscarSugestao, contagem, votar };
