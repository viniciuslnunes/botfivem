const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config/index.js');
const tema = require('../tema');

// Comandos de texto públicos: !ping, !sociais e !parceiros. Não consomem a
// mensagem (o resto da cadeia ainda a vê, como sempre foi).
function registrarFalha(err) {
  console.error('[sociais] Erro ao responder:', err);
}

async function aoMensagem(message) {
  if (message.content === '!ping') {
    message.reply('Pong!').catch(registrarFalha);
  }

  if (message.content === '!sociais') {
    message.channel.send({
      embeds: [
        {
          color: tema.cor.primaria,
          title: `🌐 REDES SOCIAIS ${tema.marca.dosNome}`,
          description: 'Acesse todas as nossas redes sociais aqui:\n\n[Clique aqui](' + config.links.redesSociais + ')',
          thumbnail: {
            url: tema.urlLogo()
          }
        }
      ],
      files: [
        tema.logo()
      ]
    }).catch(registrarFalha);
  }

  if (message.content === '!parceiros') {
    const embed = {
      color: tema.cor.primaria,
      title: `🤝 PARCEIROS ${tema.marca.dosNome}`,
      description: tema.marca.textos.parceiros,
      image: {
        url: tema.urlLogo()
      }
    };
    const row = new ActionRowBuilder().addComponents(
      ...config.parceiros.map(p => new ButtonBuilder()
        .setLabel(p.label)
        .setStyle(ButtonStyle.Link)
        .setURL(p.url))
    );
    message.channel.send({
      embeds: [embed],
      components: [row],
      files: [
        tema.logo()
      ]
    }).catch(registrarFalha);
  }
}

module.exports = { aoMensagem };
