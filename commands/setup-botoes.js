const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-botoes')
    .setDescription('Envia as mensagens fixas com botões nos canais de validação e bloqueio de ID.'),
  async execute(interaction) {
    // Canal de validação de ID
    const canalValidar = interaction.guild.channels.cache.get('1487943479710580756');
    if (canalValidar) {
      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('VALIDAÇÃO DE ID - GAVIÕES DA FIEL - FIVEM')
        .setDescription('Clique no botão abaixo para validar se um ID está impedido de ser recrutado!');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('abrir_validarid')
          .setLabel('VALIDAR ID')
          .setStyle(ButtonStyle.Primary)
      );
      await canalValidar.send({ embeds: [embed], components: [row] });
    }
    // Canal de bloqueio de ID
    const canalBloquear = interaction.guild.channels.cache.get('1487943419203551313');
    if (canalBloquear) {
      const embed = new EmbedBuilder()
        .setColor(0xED4245)
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
    if (canalAdvertencia) {
      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('ADVERTÊNCIAS - GAVIÕES DA FIEL - FIVEM')
        .setDescription('Use os botões abaixo para registrar ou remover uma advertência de um membro.');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('abrir_registrar_advertencia')
          .setLabel('⛔ REGISTRAR ADVERTÊNCIA')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('abrir_remover_advertencia')
          .setLabel('✅ REMOVER ADVERTÊNCIA')
          .setStyle(ButtonStyle.Success)
      );
      await canalAdvertencia.send({ embeds: [embed], components: [row] });
    }
    // Canal de solicitação de carteirinha
    const canalCarteirinha = interaction.guild.channels.cache.get('1489527029568245891');
    if (canalCarteirinha) {
      const embed = new EmbedBuilder()
        .setColor(0xCC0000)
        .setTitle('🪪 CARTEIRINHA DE SÓCIO — GAVIÕES DA FIEL FIVEM')
        .setDescription('Clique no botão abaixo para emitir ou consultar sua carteirinha de sócio.');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('solicitar_carteirinha')
          .setLabel('🪪 SOLICITAR CARTEIRINHA')
          .setStyle(ButtonStyle.Danger)
      );
      await canalCarteirinha.send({ embeds: [embed], components: [row] });
    }
    await interaction.reply({ content: 'Mensagens fixas enviadas!', flags: 64 });
  }
};
