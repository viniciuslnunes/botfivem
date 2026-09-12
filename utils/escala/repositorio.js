const db = require('../db');

// Trocar a função de quem já estava escalado reabre a pergunta (volta a CONVOCADO)
async function convocar(eventoId, discordId, funcao, porId) {
  const { rows: [atual] } = await db.query(
    'SELECT funcao, status FROM evento_escala WHERE evento_id = $1 AND discord_id = $2', [eventoId, discordId]);
  if (atual && atual.funcao === funcao && atual.status !== 'RECUSADO') return { erro: 'ja_escalado', atual };
  const { rows: [linha] } = await db.query(
    `INSERT INTO evento_escala (evento_id, discord_id, funcao, status, convocado_por_id)
     VALUES ($1, $2, $3, 'CONVOCADO', $4)
     ON CONFLICT (evento_id, discord_id) DO UPDATE
       SET funcao = $3, status = 'CONVOCADO', convocado_por_id = $4, convocado_em = now(), respondido_em = NULL
     RETURNING *`,
    [eventoId, discordId, funcao, porId]
  );
  return { linha, trocouFuncao: Boolean(atual) };
}

// Responder é da própria pessoa
async function responder(eventoId, discordId, aceitar) {
  const { rows: [linha] } = await db.query(
    `UPDATE evento_escala SET status = $3, respondido_em = now()
      WHERE evento_id = $1 AND discord_id = $2 RETURNING *`,
    [eventoId, discordId, aceitar ? 'ACEITO' : 'RECUSADO']
  );
  return linha ?? null;
}

async function listarEscala(eventoId) {
  const { rows } = await db.query('SELECT * FROM evento_escala WHERE evento_id = $1 ORDER BY funcao, convocado_em', [eventoId]);
  return rows;
}

async function removerDaEscala(eventoId, discordId) {
  const { rowCount } = await db.query('DELETE FROM evento_escala WHERE evento_id = $1 AND discord_id = $2', [eventoId, discordId]);
  return rowCount > 0;
}

module.exports = { convocar, responder, listarEscala, removerDaEscala };
