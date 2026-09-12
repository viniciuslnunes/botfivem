const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config/index.js');

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
    const canalValidar = interaction.guild.channels.cache.get(config.canais.validarId);
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
    const canalBloquear = interaction.guild.channels.cache.get(config.canais.naoRecrutar);
    if (canalBloquear) {
      const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('NÃO RECRUTAR - GAVIÕES DA FIEL - FIVEM')
        .setDescription('Use os botões abaixo para adicionar ou remover um ID da lista de não recrutar!');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('abrir_bloquearid')
          .setLabel('BLOQUEAR NOVO ID')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('abrir_desbloquearid')
          .setLabel('REMOVER ID BLOQUEADO')
          .setStyle(ButtonStyle.Secondary)
      );
      // Atualiza a mensagem fixa já existente (que só tinha o botão de bloquear) em vez de duplicar
      const msgs = await canalBloquear.messages.fetch({ limit: 20 });
      const existente = msgs.find(m => m.author.id === client.user.id && m.components.length > 0);
      if (existente) {
        await existente.edit({ embeds: [embed], components: [row] });
      } else {
        await canalBloquear.send({ embeds: [embed], components: [row] });
      }
    }

    // Canal de advertência
    const canalAdvertencia = interaction.guild.channels.cache.get(config.canais.advertencia);
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
    const canalCarteirinha = interaction.guild.channels.cache.get(config.canais.carteirinha);
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
    const canalTicket = interaction.guild.channels.cache.get(config.canais.ticket);
    if (canalTicket && !await jaTemBotao(canalTicket, client)) {
      const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('🎫 TICKET - GAVIÕES DA FIEL - FIVEM')
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

    // Canal de advertências de recrutadores
    const canalAdvRec = interaction.guild.channels.cache.get(config.canais.advRecrutadores);
    if (canalAdvRec && !await jaTemBotao(canalAdvRec, client)) {
      const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('⛔ ADVERTÊNCIAS DE RECRUTADORES — GAVIÕES DA FIEL FIVEM')
        .setDescription('Use os botões abaixo para registrar ou remover uma advertência de um recrutador.');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('abrir_registrar_adv_rec')
          .setLabel('⛔ REGISTRAR ADVERTÊNCIA')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('abrir_remover_adv_rec')
          .setLabel('🦅 REMOVER ADVERTÊNCIA')
          .setStyle(ButtonStyle.Secondary)
      );
      await canalAdvRec.send({ embeds: [embed], components: [row] });
    }

    await interaction.reply({ content: '🦅 Mensagens fixas verificadas/enviadas!', flags: 64 });
  }
};
