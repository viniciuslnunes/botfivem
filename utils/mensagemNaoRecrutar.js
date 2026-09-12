// Mensagem fixa do canal ❌・nao-recrutar (bloquear / remover ID bloqueado)
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../config/index.js');

// Garante a mensagem com os dois botões: edita a já existente (inclusive a antiga,
// que só tinha "BLOQUEAR NOVO ID") ou envia uma nova se não houver nenhuma
async function garantirMensagemNaoRecrutar(client) {
  const canal = await client.channels.fetch(config.canais.naoRecrutar).catch(() => null);
  if (!canal || !canal.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(0x000000)
    .setTitle('NÃO RECRUTAR - GAVIÕES DA FIEL - FIVEM')
    .setDescription('Use os botões abaixo para adicionar ou remover um ID da lista de não recrutar!');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('abrir_bloquearid')
      .setLabel('BLOQUEAR NOVO ID')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('abrir_desbloquearid')
      .setLabel('REMOVER ID BLOQUEADO')
      .setStyle(ButtonStyle.Secondary)
  );

  const msgs = await canal.messages.fetch({ limit: 20 });
  const existente = msgs.find(m => m.author.id === client.user.id && m.components.length > 0);
  if (existente) {
    await existente.edit({ embeds: [embed], components: [row] });
  } else {
    await canal.send({ embeds: [embed], components: [row] });
  }
}

module.exports = { garantirMensagemNaoRecrutar };
