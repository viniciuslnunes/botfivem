// Handler de eventos: ready
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../config/index.js');

module.exports = (client) => {
  client.once('clientReady', async () => {
    console.log(`Bot online como ${client.user.tag}`);
    // Enviar mensagem fixa de recrutamento no canal de análise
    try {
      const canalRecrutamento = await client.channels.fetch(config.canais.recrutamento);
      if (canalRecrutamento) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('abrir_recrutamento')
            .setLabel('SOLICITAR RECRUTAMENTO')
            .setStyle(ButtonStyle.Primary)
        );
        const embed = new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle('RECRUTAMENTO - GAVIÕES DA FIEL - FIVEM')
          .setDescription('Clique no botão abaixo para solicitar seu recrutamento!')
          .setThumbnail('attachment://gavioesdafielfivem_logo.png');
        await canalRecrutamento.send({
          embeds: [embed],
          components: [row],
          files: [{ attachment: './img/gavioesdafielfivem_logo.png', name: 'gavioesdafielfivem_logo.png' }]
        });
      }
    } catch (err) {
      console.error('Erro ao enviar mensagem fixa de recrutamento:', err);
    }
  });
};
