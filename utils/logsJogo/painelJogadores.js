const db = require('../db');
const config = require('../../config/index.js');
const { montarEmbedJogadoresOnline } = require('./relatorios');
const { linhaBotoesPresenca } = require('./presencaInteracoes');

// Painel fixo de jogadores online (quantos e quem, mais o pico de
// simultâneos por período), editado periodicamente. Estado recalculável:
// perder um ciclo num reinício não tem custo.
const CONFIG_KEY = 'painel_jogadores_message_id';

async function atualizarPainelJogadores(client) {
  const canal = await client.channels.fetch(config.logsJogo.canalPainelJogadores).catch(() => null);
  if (!canal) return;

  const embed = await montarEmbedJogadoresOnline();
  const components = [linhaBotoesPresenca()];
  const res = await db.query('SELECT value FROM bot_config WHERE key = $1', [CONFIG_KEY]);
  const messageId = res.rows[0]?.value;

  if (messageId) {
    try {
      const msg = await canal.messages.fetch(messageId);
      await msg.edit({ embeds: [embed], components, allowedMentions: { parse: [] } });
      return;
    } catch {
      // mensagem apagada — recriar
    }
  }
  const nova = await canal.send({ embeds: [embed], components, allowedMentions: { parse: [] } });
  await db.query(
    'INSERT INTO bot_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
    [CONFIG_KEY, nova.id]
  );
}

function iniciarPainelJogadores(client) {
  if (!config.logsJogo.canalPainelJogadores) return;
  const atualizar = () => atualizarPainelJogadores(client).catch(err => console.error('[painel-jogadores] Erro ao atualizar:', err));
  atualizar();
  setInterval(atualizar, config.logsJogo.painelJogadoresIntervaloMin * 60 * 1000);
}

module.exports = { atualizarPainelJogadores, iniciarPainelJogadores };
