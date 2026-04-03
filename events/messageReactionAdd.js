const { EmbedBuilder } = require('discord.js');

const EMOJI_CONFIRMAR_ID = '1489501021108441240'; // :GAVIO: (customizado)
const EMOJI_RECUSAR      = '❌';

async function atualizarListaEvento(message) {
  try {
    // Busca a reação de confirmar e todos os usuários que reagiram
    const reacao = message.reactions.cache.find(r => r.emoji.id === EMOJI_CONFIRMAR_ID);
    let confirmados = [];
    if (reacao) {
      const users = await reacao.users.fetch();
      confirmados = [...users.filter(u => !u.bot).values()];
    }

    const embed = message.embeds[0];
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
    await message.edit({ embeds: [novoEmbed] });
  } catch (err) {
    console.error('[evento] Erro ao atualizar lista:', err);
  }
}

module.exports = (client) => {
  client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;

    // Resolver partials
    if (reaction.partial) {
      try { await reaction.fetch(); } catch { return; }
    }
    if (reaction.message.partial) {
      try { await reaction.message.fetch(); } catch { return; }
    }

    const message = reaction.message;

    // A mensagem precisa ser do bot
    if (!message.author?.bot) return;

    // Verificar se é uma mensagem de evento (footer 'evento')
    const embed = message.embeds?.[0];
    if (!embed || embed.footer?.text !== 'evento') return;

    const isConfirmar = reaction.emoji.id === EMOJI_CONFIRMAR_ID;
    const isRecusar   = reaction.emoji.name === EMOJI_RECUSAR && !reaction.emoji.id;
    if (!isConfirmar && !isRecusar) return;

    // Só atualiza lista se for o emoji de confirmar
    if (isConfirmar) {
      await atualizarListaEvento(message);
    }
  });
};
