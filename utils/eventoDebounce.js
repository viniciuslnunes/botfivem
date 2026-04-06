const { EmbedBuilder, Routes } = require('discord.js');

const EMOJI_CONFIRMAR = '🦅';
const locks = new Map(); // messageId -> { busy, queued }

async function _doUpdate(message) {
  // Busca usuários direto pela REST API — sem nenhuma camada de cache/debounce
  let rawUsers = [];
  try {
    rawUsers = await message.client.rest.get(
      Routes.channelMessageReaction(message.channelId, message.id, encodeURIComponent(EMOJI_CONFIRMAR)),
      { query: new URLSearchParams({ limit: '100' }) }
    );
    console.log(`[evento] API retornou ${rawUsers.length} usuário(s):`, rawUsers.map(u => `${u.username} (bot=${u.bot})`));
  } catch (err) {
    if (err.status !== 404) throw err;
    console.log('[evento] API retornou 404 — sem reações ainda');
  }
  const confirmados = rawUsers.filter(u => !u.bot);
  console.log(`[evento] Confirmados após filtrar bots: ${confirmados.length}`);

  // Busca a mensagem fresca via canal (evita referência stale)
  const channel = await message.client.channels.fetch(message.channelId);
  const freshMessage = await channel.messages.fetch(message.id, { force: true });
  const embed = freshMessage.embeds[0];
  if (!embed) return;

  const novoEmbed = EmbedBuilder.from(embed);
  const confirmedText = confirmados.length
    ? confirmados.map(u => `<@${u.id}>`).join('\n')
    : '*Nenhum confirmado ainda*';

  const fields = (novoEmbed.data.fields || []).map(f => {
    if (f.name.includes('Confirmados')) {
      const emojiPrefix = f.name.split(' ')[0];
      return { name: `${emojiPrefix} Confirmados (${confirmados.length})`, value: confirmedText, inline: f.inline };
    }
    return f;
  });

  novoEmbed.setFields(fields);
  await freshMessage.edit({ embeds: [novoEmbed] });
  console.log(`[evento] Lista atualizada: ${confirmados.length} confirmado(s) — msg ${message.id}`);
}

async function atualizarListaEvento(message) {
  const msgId = message.id;
  if (!locks.has(msgId)) locks.set(msgId, { busy: false, queued: false });
  const lock = locks.get(msgId);

  // Se já está atualizando, marca dirty e sai — o loop abaixo vai relançar
  if (lock.busy) {
    lock.queued = true;
    return;
  }

  // Roda o update; se novas reações chegaram enquanto rodava (queued=true), roda de novo
  do {
    lock.busy = true;
    lock.queued = false;
    try {
      await _doUpdate(message);
    } catch (err) {
      console.error('[evento] Erro ao atualizar lista:', err);
    }
    lock.busy = false;
  } while (lock.queued);

  locks.delete(msgId);
}

module.exports = { atualizarListaEvento };
