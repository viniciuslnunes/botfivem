const db = require('../db');

// Post de divulgação no canal de recrutamento. Só registra na primeira vez.
async function registrarPost({ messageId, autorId, postadoEm }) {
  await db.query(
    `INSERT INTO divulgacoes_recrutamento (message_id, autor_id, postado_em)
     VALUES ($1, $2, $3) ON CONFLICT (message_id) DO NOTHING`,
    [messageId, autorId, postadoEm ?? new Date()]
  );
}

// Mais recente primeiro.
async function ultimosPosts(limite = 200) {
  const { rows } = await db.query(
    'SELECT message_id, autor_id, postado_em FROM divulgacoes_recrutamento ORDER BY postado_em DESC LIMIT $1',
    [limite]
  );
  return rows;
}

module.exports = { registrarPost, ultimosPosts };
