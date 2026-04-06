// Handler de eventos: messageCreate
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const CANAL_LOGS_LIDERANCA  = '1461544673825783929';
const CANAL_ALERTA_NOVATOS  = '1490536504748150925';

// Cargos acima de sócio — serão mencionados no alerta
const CARGOS_MENCIONAR = [
  '1198743169081295021', // GDF • PRESIDENTE
  '1198743169081295020', // GDF • VICE PRESIDENTE
  '1380046518157054013', // GDF • VELHA GUARDA
  '1198743169081295019', // GDF • DIRETORIA
  '1198743169030951010', // EQUIPE RECRUTAMENTO
];

module.exports = (client) => {
  client.on('messageCreate', async message => {
    // ── Alerta de novato via logs-liderança ──────────────────────────────────
    if (message.channelId === CANAL_LOGS_LIDERANCA && message.author.bot) {
      const embed = message.embeds?.[0];
      if (!embed) return;

      const descricao = embed.description ?? '';
      const isNovato = /novato/i.test(descricao) && /entrou na sua torcida/i.test(descricao);
      if (!isNovato) return;

      // Extrair nome e ID da descrição — suporta com e sem markdown bold e espaços extras
      // Formato real:  "O Novato Rarin Dimarolla (ID: 8914 ) entrou..."
      // Formato mock:  "O Novato **Rarin Dimarolla** (ID: **8914**) entrou..."
      const nomeMatch = descricao.match(/O Novato \*?\*?(.+?)\*?\*?\s*\(ID:/i);
      const idMatch   = descricao.match(/\(ID:\s*\*?\*?(\d+)\*?\*?\s*\)/i);
      const nome = nomeMatch?.[1]?.trim() ?? 'Desconhecido';
      const id   = idMatch?.[1]   ?? 'N/A';

      const alerta = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('🆕 NOVO NOVATO DETECTADO')
        .setDescription(`Um novo jogador entrou na torcida como **Novato** no jogo.\nRecrute-o para o servidor do Discord!`)
        .addFields(
          { name: '👤 Nome no Jogo', value: nome, inline: true },
          { name: '🆔 ID FiveM',     value: id,   inline: true }
        )
        .setFooter({ text: `Detectado automaticamente via logs-liderança` })
        .setTimestamp();

      try {
        const canalAlerta = await client.channels.fetch(CANAL_ALERTA_NOVATOS);
        const mencoes = CARGOS_MENCIONAR.map(id => `<@&${id}>`).join(' ');
        await canalAlerta.send({ content: mencoes, embeds: [alerta] });
      } catch (err) {
        console.error('[novato] Erro ao enviar alerta:', err);
      }
      return;
    }
    // ────────────────────────────────────────────────────────────────────────
    if (message.content === '!ping') {
      message.reply('Pong!');
    }
    if (message.content === '!sociais') {
      message.channel.send({
        embeds: [
          {
            color: 0x000000,
            title: '🌐 REDES SOCIAIS DOS GAVIÕES DA FIEL - FIVEM',
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
          .setStyle(ButtonStyle.Secondary)
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
