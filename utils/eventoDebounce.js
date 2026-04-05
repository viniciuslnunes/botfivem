const { EmbedBuilder, Routes } = require('discord.js');

const EMOJI_CONFIRMAR = '🦅';
const pendingUpdates  = new Map();

async function atualizarListaEvento(message) {
  if (pendingUpdates.has(message.id)) {
    clearTimeout(pendingUpdates.get(message.id));
  }

  pendingUpdates.set(message.id, setTimeout(async () => {
    pendingUpdates.delete(message.id);
    try {
      // Buscar usuários direto pela REST API — sem passar por nenhum cache do Discord.js
      let rawUsers = [];
      try {
        rawUsers = await message.client.rest.get(
          Routes.channelMessageReaction(message.channelId, message.id, encodeURIComponent(EMOJI_CONFIRMAR)),
          { query: new URLSearchParams({ limit: '100' }) }
        );
      } catch {
        rawUsers = []; // 404 = ainda não há reações
      }
      const confirmados = rawUsers.filter(u => !u.bot);

      // Buscar mensagem fresca apenas para editar o embed
      const freshMessage = await message.channel.messages.fetch(message.id, { force: true });
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
