const db = require('../db');
const config = require('../../config/index.js');
const { resolverPeriodo } = require('./estatisticas');
const { montarEmbedTorcida } = require('./relatorios');

// Painel fixo de estatísticas (últimos 7 dias), editado periodicamente.
// Estado recalculável: perder um ciclo num reinício não tem custo.
const CONFIG_KEY = 'painel_logs_message_id';

async function atualizarPainelLogs(client) {
  const canal = await client.channels.fetch(config.logsJogo.canalPainel).catch(() => null);
  if (!canal) return;

  const embed = await montarEmbedTorcida(resolverPeriodo('7d'));
  const res = await db.query('SELECT value FROM bot_config WHERE key = $1', [CONFIG_KEY]);
  const messageId = res.rows[0]?.value;

  if (messageId) {
    try {
      const msg = await canal.messages.fetch(messageId);
      await msg.edit({ embeds: [embed], allowedMentions: { parse: [] } });
      return;
    } catch {
      // mensagem apagada — recriar
    }
  }
  const nova = await canal.send({ embeds: [embed], allowedMentions: { parse: [] } });
  await db.query(
    'INSERT INTO bot_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
    [CONFIG_KEY, nova.id]
  );
}

function iniciarPainelLogs(client) {
  if (!config.logsJogo.canalPainel) return;
  const atualizar = () => atualizarPainelLogs(client).catch(err => console.error('[painel-logs] Erro ao atualizar:', err));
  atualizar();
  setInterval(atualizar, config.logsJogo.painelIntervaloMin * 60 * 1000);
}

module.exports = { atualizarPainelLogs, iniciarPainelLogs };
