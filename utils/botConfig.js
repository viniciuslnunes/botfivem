const db = require('./db');

// Chave/valor persistente do bot (IDs de mensagens fixas, canais criados pelo bot)

async function lerConfig(chave) {
  const res = await db.query('SELECT value FROM bot_config WHERE key = $1', [chave]);
  return res.rows[0]?.value ?? null;
}

async function gravarConfig(chave, valor) {
  await db.query(
    'INSERT INTO bot_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
    [chave, valor]
  );
}

module.exports = { lerConfig, gravarConfig };
