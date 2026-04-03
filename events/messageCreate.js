// Handler de eventos: messageCreate
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = (client) => {
  client.on('messageCreate', message => {
    if (message.content === '!ping') {
      message.reply('Pong!');
    }
    if (message.content === '!sociais') {
      message.channel.send({
        embeds: [
          {
            color: 0x000000,
            title: '🌐 REDES SOCIAIS',
            description: 'Acesse todas as nossas redes sociais aqui:\n\n[Clique aqui](https://linktr.ee/gavioesdafielfivem)',
            thumbnail: {
              url: 'attachment://gavioesdafielfivem_logo.png'
            }
          }
        ],
        files: [
          {
            attachment: './img/gavioesdafielfivem_logo.png',
            name: 'gavioesdafielfivem_logo.png'
          }
        ]
      });
    }
    if (message.content === '!parceiros') {
      const embed = {
        color: 0x000000,
        title: '🤝 PARCEIROS DOS GAVIÕES DA FIEL - FIVEM',
        description: 'A FIEL é gigante, e só cresce porque temos ao nosso lado parceiros que apoiam a nossa paixão pelo Corinthians.\nClique nos botões abaixo e conheça cada um deles!',
        image: {
          url: 'attachment://gavioesdafielfivem_logo.png'
        }
      };
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('BX STORE')
          .setStyle(ButtonStyle.Link)
          .setURL('https://discord.gg/gtbXKJamP4'),
        new ButtonBuilder()
          .setLabel('SCCP DISCORD')
          .setStyle(ButtonStyle.Link)
          .setURL('https://discord.gg/sccp'),
        new ButtonBuilder()
          .setLabel('FUT CORINTHIANS')
          .setStyle(ButtonStyle.Link)
          .setURL('https://www.tiktok.com/@fut_corinthians')
      );
      message.channel.send({
        embeds: [embed],
        components: [row],
        files: [
          {
            attachment: './img/gavioesdafielfivem_logo.png',
            name: 'gavioesdafielfivem_logo.png'
          }
        ]
      });
    }
    // Botão para validar ID no canal 📝・validar-id
    if (message.channelId === '1487943479710580756' && !message.author.bot) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('abrir_validarid')
          .setLabel('Validar ID')
          .setStyle(ButtonStyle.Primary)
      );
      message.reply({ content: 'Clique para validar um ID:', components: [row] });
    }
    // Botão para abrir formulário de bloqueio no canal ❌・nao-recrutar
    if (message.channelId === '1487943419203551313' && !message.author.bot) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('abrir_bloquearid')
          .setLabel('Bloquear novo ID')
          .setStyle(ButtonStyle.Danger)
      );
      message.reply({ content: 'Clique para bloquear um novo ID:', components: [row] });
    }
  });
};
