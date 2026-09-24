const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../config/index.js');
const tema = require('../tema');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('enviarrecrutamento')
    .setDescription('Envia manualmente o botão de recrutamento no canal de recrutamento.'),
  async execute(interaction) {
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
    const canal = await interaction.client.channels.fetch(config.canais.recrutamento);
    await canal.send({
      embeds: [embed],
      components: [row],
      files: [tema.logo()]
    });
    await interaction.reply({ content: 'Botão enviado no canal de recrutamento!', flags: 64 });
  }
};
