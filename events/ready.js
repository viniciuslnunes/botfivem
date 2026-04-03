// Handler de eventos: ready
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../config/index.js');

module.exports = (client) => {
  client.once('clientReady', async () => {
    console.log(`Bot online como ${client.user.tag}`);
    // Enviar mensagem fixa de recrutamento no canal de análise (somente se não existir)
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
            .setColor(0x000000)
            .setTitle('RECRUTAMENTO - GAVIÕES DA FIEL - FIVEM')
            .setDescription('Clique no botão abaixo para solicitar seu recrutamento!')
            .setThumbnail('attachment://gavioesdafielfivem_logo.png');
          await canalRecrutamento.send({
            embeds: [embed],
            components: [row],
            files: [{ attachment: './img/gavioesdafielfivem_logo.png', name: 'gavioesdafielfivem_logo.png' }]
          });
        }
      }
    } catch (err) {
      console.error('Erro ao enviar mensagem fixa de recrutamento:', err);
    }

    // Enviar mensagem fixa de ticket (somente se não existir)
    try {
      const canalTicket = await client.channels.fetch('1442247874808385797');
      if (canalTicket) {
        const msgs = await canalTicket.messages.fetch({ limit: 20 });
        const jaExiste = msgs.some(m => m.author.id === client.user.id && m.components.length > 0);
        if (!jaExiste) {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('abrir_ticket')
              .setLabel('🎫 ABRIR TICKET')
              .setStyle(ButtonStyle.Secondary)
          );
          const embed = new EmbedBuilder()
            .setColor(0x000000)
            .setTitle('🎫 Ticket Gaviões da Fiel')
            .setDescription('Clique no botão abaixo para abrir um ticket e falar com a nossa equipe de suporte.')
            .setImage('attachment://FAIXA_19.jpg');
          await canalTicket.send({
            embeds: [embed],
            components: [row],
            files: [{ attachment: './img/FAIXA_19.jpg', name: 'FAIXA_19.jpg' }]
          });
        }
      }
    } catch (err) {
      console.error('Erro ao enviar mensagem fixa de ticket:', err);
    }
  });
};
