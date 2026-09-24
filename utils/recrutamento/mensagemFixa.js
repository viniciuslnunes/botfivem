const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../../config/index.js');
const tema = require('../../tema');
const { garantirMensagemFixa } = require('../mensagemFixa');
const { textoRegrasManto } = require('./regrasManto');

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
  await garantirMensagemProvarManto(client);
}

// Regras da provagem de manto fixas no canal provar-manto (o candidato lê antes
// de mandar a foto). Uma mensagem só, editada se o texto mudar.
async function garantirMensagemProvarManto(client) {
  try {
    const canal = await client.channels.fetch(config.canais.provarManto);
    if (!canal) return;
    await garantirMensagemFixa(canal, 'intro_provar_manto', () => ({
      embeds: [new EmbedBuilder()
        .setColor(tema.cor.primaria)
        .setTitle(tema.tituloSegmentado('PROVAR MANTO'))
        .setDescription(textoRegrasManto())],
    }));
  } catch (err) {
    console.error('Erro ao enviar mensagem fixa de provar-manto:', err);
  }
}

module.exports = { garantirMensagemRecrutamento, garantirMensagemProvarManto };
