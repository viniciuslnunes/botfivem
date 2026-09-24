const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../config/index.js');
const tema = require('../../tema');

const ID_BOTAO_NOVA = 'sug:nova';

function montarPainel() {
  return {
    embeds: [{
      color: tema.cor.primaria,
      title: tema.tituloSegmentado('💡 SUGESTÕES'),
      description: 'Tem uma ideia para melhorar o **processo da torcida** ou o **Discord**?\n\n'
        + '• **Recrutadores e acima** enviam sugestões pelo botão abaixo.\n'
        + '• **Sócios e acima** votam em cada sugestão. Um voto por pessoa; clicar de novo retira.\n'
        + '• Cada sugestão ganha um tópico para a discussão.',
    }],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(ID_BOTAO_NOVA).setLabel('ENVIAR SUGESTÃO').setEmoji('💡').setStyle(ButtonStyle.Secondary)
    )],
  };
}

// Sem ButtonStyle.Success: nada verde (tema.proibido). Os dois votos são neutros.
function montarBotoesVoto(id, { aprovo, contra }) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sug:votar:${id}:A`).setLabel(String(aprovo)).setEmoji(tema.emoji.ok).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`sug:votar:${id}:C`).setLabel(String(contra)).setEmoji(tema.emoji.recusado).setStyle(ButtonStyle.Secondary)
  )];
}

function montarSugestao(sugestao, autorNome, contagem = { aprovo: 0, contra: 0 }) {
  return {
    embeds: [{
      color: tema.cor.primaria,
      title: `💡 SUGESTÃO #${sugestao.id}`,
      description: sugestao.texto,
      footer: { text: `Enviado por ${autorNome}` },
    }],
    components: montarBotoesVoto(sugestao.id, contagem),
    allowedMentions: { parse: [] },
  };
}

function ehMensagemDoPainel(mensagem, botId) {
  if (mensagem.author?.id !== botId) return false;
  return (mensagem.components ?? []).some(linha => (linha.components ?? []).some(c => (c.customId ?? c.data?.custom_id) === ID_BOTAO_NOVA));
}

// O botão fica SEMPRE por último: a cada sugestão nova o painel antigo some e
// é reposto no fim (senão o botão fica enterrado atrás das sugestões).
async function garantirPainelNoFim(client) {
  const canalId = config.canais.sugestoes;
  if (!canalId) return;
  try {
    const canal = await client.channels.fetch(canalId);
    if (!canal?.isTextBased()) return;
    const recentes = await canal.messages.fetch({ limit: 50 });
    const ultima = [...recentes.values()][0];
    if (ultima && ehMensagemDoPainel(ultima, client.user.id)) return;
    for (const m of recentes.values()) {
      if (ehMensagemDoPainel(m, client.user.id)) await m.delete().catch(() => {});
    }
    await canal.send(montarPainel());
  } catch (err) {
    console.error('[sugestoes] erro ao garantir o painel:', err.message);
  }
}

module.exports = { montarPainel, montarSugestao, montarBotoesVoto, garantirPainelNoFim, ID_BOTAO_NOVA };
