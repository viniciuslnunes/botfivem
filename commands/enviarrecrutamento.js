const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../config/index.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('enviarrecrutamento')
    .setDescription('Envia manualmente o botão de recrutamento no canal de recrutamento.'),
  async execute(interaction) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('abrir_recrutamento')
        .setLabel('SOLICITAR RECRUTAMENTO')
        .setStyle(ButtonStyle.Primary)
    );
    const embed = new EmbedBuilder()
      .setColor(0x000000)
      .setTitle('RECRUTAMENTO - GAVIÕES DA FIEL - FIVEM')
      .setDescription('Clique no botão abaixo para solicitar seu recrutamento!')
      .setThumbnail('attachment://gavioesdafielfivem_logo.png');
    const canal = await interaction.client.channels.fetch(config.canais.recrutamento);
    await canal.send({
      embeds: [embed],
      components: [row],
      files: [{ attachment: './img/gavioesdafielfivem_logo.png', name: 'gavioesdafielfivem_logo.png' }]
    });
    await interaction.reply({ content: 'Botão enviado no canal de recrutamento!', flags: 64 });
  }
};
