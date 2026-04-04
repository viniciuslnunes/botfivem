const db = require('./db');

const CANAL_TOP = '1444861031598784673';
const CONFIG_KEY = 'top_recrutadores_message_id';

async function getTopMessageId() {
  const res = await db.query('SELECT value FROM bot_config WHERE key = $1', [CONFIG_KEY]);
  return res.rows.length > 0 ? res.rows[0].value : null;
}

async function setTopMessageId(id) {
  await db.query(
    'INSERT INTO bot_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
    [CONFIG_KEY, id]
  );
}

async function construirEmbed() {
  const result = await db.query(
    'SELECT aprovador_id, COUNT(*) as total FROM aprovacoes_recrutamento GROUP BY aprovador_id ORDER BY total DESC LIMIT 25'
  );
  const rows = result.rows;

  let descricao = '';
  for (let i = 0; i < rows.length; i++) {
    const { aprovador_id, total } = rows[i];
    descricao += `${i + 1}. <@${aprovador_id}> — **${total} APROVAÇÕES**\n`;
  }

  if (!descricao) descricao = '*NENHUMA APROVAÇÃO REGISTRADA AINDA.*';
  if (descricao.length > 4096) descricao = descricao.substring(0, 4093) + '...';

  return {
    color: 0x000000,
    title: '🏆 TOP RECRUTADORES',
    description: descricao,
    footer: { text: `Total: ${rows.length} recrutador${rows.length !== 1 ? 'es' : ''}` },
    timestamp: new Date().toISOString(),
  };
}

async function atualizarTopRecrutadores(client) {
  try {
    const canal = await client.channels.fetch(CANAL_TOP);
    if (!canal) return;

    const embed = await construirEmbed();
    const messageId = await getTopMessageId();

    if (messageId) {
      try {
        const msg = await canal.messages.fetch(messageId);
        await msg.edit({ embeds: [embed], allowedMentions: { users: [] } });
        return;
      } catch {
        // mensagem deletada — recriar
      }
    }

    const sent = await canal.send({ embeds: [embed], allowedMentions: { users: [] } });
    await setTopMessageId(sent.id);
  } catch (err) {
    console.error('[topRecrutadores] Erro ao atualizar:', err);
  }
}

module.exports = { atualizarTopRecrutadores };
