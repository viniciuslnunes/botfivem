const { EmbedBuilder } = require('discord.js');

const EMOJI_CONFIRMAR = '🦅';
const pendingUpdates  = new Map();

async function atualizarListaEvento(message) {
  if (pendingUpdates.has(message.id)) {
    clearTimeout(pendingUpdates.get(message.id));
  }

  pendingUpdates.set(message.id, setTimeout(async () => {
    pendingUpdates.delete(message.id);
    try {
      const freshMessage = await message.fetch(true);
      const reacao = freshMessage.reactions.cache.find(r => r.emoji.name === EMOJI_CONFIRMAR && !r.emoji.id);
      let confirmados = [];
      if (reacao) {
        const users = await reacao.users.fetch();
        confirmados = [...users.filter(u => !u.bot).values()];
      }

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
    } catch (err) {
      console.error('[evento] Erro ao atualizar lista:', err);
    }
  }, 1000));
}

module.exports = { atualizarListaEvento };
