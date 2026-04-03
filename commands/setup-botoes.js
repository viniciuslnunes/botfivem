const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Verifica se já existe mensagem do bot com botões no canal; retorna true se já existir
async function jaTemBotao(canal, client) {
  const msgs = await canal.messages.fetch({ limit: 20 });
  return msgs.some(m => m.author.id === client.user.id && m.components.length > 0);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-botoes')
    .setDescription('Envia as mensagens fixas com botões nos canais de validação e bloqueio de ID.'),
  async execute(interaction) {
    const { client } = interaction;

    // Canal de validação de ID
    const canalValidar = interaction.guild.channels.cache.get('1487943479710580756');
    if (canalValidar && !await jaTemBotao(canalValidar, client)) {
      const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('VALIDAÇÃO DE ID - GAVIÕES DA FIEL - FIVEM')
        .setDescription('Clique no botão abaixo para validar se um ID está impedido de ser recrutado!');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('abrir_validarid')
          .setLabel('VALIDAR ID')
          .setStyle(ButtonStyle.Secondary)
      );
      await canalValidar.send({ embeds: [embed], components: [row] });
    }

    // Canal de bloqueio de ID
    const canalBloquear = interaction.guild.channels.cache.get('1487943419203551313');
    if (canalBloquear && !await jaTemBotao(canalBloquear, client)) {
      const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('NÃO RECRUTAR - GAVIÕES DA FIEL - FIVEM')
        .setDescription('Clique no botão abaixo para adicionar um novo ID à lista de não recrutar!');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('abrir_bloquearid')
          .setLabel('BLOQUEAR NOVO ID')
          .setStyle(ButtonStyle.Danger)
      );
      await canalBloquear.send({ embeds: [embed], components: [row] });
    }

    // Canal de advertência
    const canalAdvertencia = interaction.guild.channels.cache.get('1488653988168601710');
    if (canalAdvertencia && !await jaTemBotao(canalAdvertencia, client)) {
      const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('ADVERTÊNCIAS - GAVIÕES DA FIEL - FIVEM')
        .setDescription('Use os botões abaixo para registrar ou remover uma advertência de um membro.');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('abrir_registrar_advertencia')
          .setLabel('⛔ REGISTRAR ADVERTÊNCIA')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('abrir_remover_advertencia')
          .setLabel('🦅 REMOVER ADVERTÊNCIA')
          .setStyle(ButtonStyle.Secondary)
      );
      await canalAdvertencia.send({ embeds: [embed], components: [row] });
    }

    // Canal de solicitação de carteirinha
    const canalCarteirinha = interaction.guild.channels.cache.get('1489527029568245891');
    if (canalCarteirinha && !await jaTemBotao(canalCarteirinha, client)) {
      const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('🪪 CARTEIRINHA DE SÓCIO — GAVIÕES DA FIEL FIVEM')
        .setDescription('Clique no botão abaixo para emitir ou consultar sua carteirinha de sócio.');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('solicitar_carteirinha')
          .setLabel('🪪 SOLICITAR CARTEIRINHA')
          .setStyle(ButtonStyle.Secondary)
      );
      await canalCarteirinha.send({ embeds: [embed], components: [row] });
    }

    // Canal de tickets
    const canalTicket = interaction.guild.channels.cache.get('1442247874808385797');
    if (canalTicket && !await jaTemBotao(canalTicket, client)) {
      const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('🎫 Ticket Gaviões da Fiel')
        .setDescription('Clique no botão abaixo para abrir um ticket e falar com a nossa equipe de suporte.')
        .setImage('attachment://FAIXA_19.jpg');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('abrir_ticket')
          .setLabel('🎫 ABRIR TICKET')
          .setStyle(ButtonStyle.Secondary)
      );
      await canalTicket.send({
        embeds: [embed],
        components: [row],
        files: [{ attachment: './img/FAIXA_19.jpg', name: 'FAIXA_19.jpg' }]
      });
    }

    await interaction.reply({ content: '🦅 Mensagens fixas verificadas/enviadas!', flags: 64 });
  }
};
