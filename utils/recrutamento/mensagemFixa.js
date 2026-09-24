const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../../config/index.js');
const tema = require('../../tema');

// Mensagem fixa de recrutamento no canal de análise (só se ainda não existir).
async function garantirMensagemRecrutamento(client) {
  try {
    const canalRecrutamento = await client.channels.fetch(config.canais.recrutamento);
    if (canalRecrutamento) {
      const msgs = await canalRecrutamento.messages.fetch({ limit: 20 });
      const jaExiste = msgs.some(m => m.author.id === client.user.id && m.components.length > 0);
      if (!jaExiste) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('abrir_recrutamento')
            .setLabel('SOLICITAR RECRUTAMENTO')
            .setStyle(ButtonStyle.Secondary)
        );
        const embed = new EmbedBuilder()
          .setColor(tema.cor.primaria)
          .setTitle(tema.tituloSegmentado('RECRUTAMENTO'))
          .setDescription('Clique no botão abaixo para solicitar seu recrutamento!')
          .setThumbnail(tema.urlLogo());
        await canalRecrutamento.send({
          embeds: [embed],
          components: [row],
          files: [tema.logo()]
        });
      }
    }
  } catch (err) {
    console.error('Erro ao enviar mensagem fixa de recrutamento:', err);
  }
}

module.exports = { garantirMensagemRecrutamento };
