const { atualizarListaEvento } = require('../utils/eventoDebounce');

const EMOJI_CONFIRMAR = '🦅';
const EMOJI_RECUSAR   = '❌';

module.exports = (client) => {
  client.on('messageReactionRemove', async (reaction, user) => {
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

    const isConfirmar = reaction.emoji.name === EMOJI_CONFIRMAR && !reaction.emoji.id;
    const isRecusar   = reaction.emoji.name === EMOJI_RECUSAR && !reaction.emoji.id;
    if (!isConfirmar && !isRecusar) return;

    // Só atualiza lista se remover o emoji de confirmar
    if (isConfirmar) {
      await atualizarListaEvento(message);
    }
  });
};
