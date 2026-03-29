const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('validarid')
    .setDescription('Valida se um ID está impedido de ser recrutado')
    .addStringOption(option =>
      option.setName('id')
        .setDescription('ID FiveM para consultar')
        .setRequired(true)),
  async execute(interaction) {
    const id = interaction.options.getString('id');
    const canalHistorico = interaction.guild.channels.cache.get('1487943943680163890');
    if (!canalHistorico || !canalHistorico.isTextBased()) {
      return interaction.reply({ content: 'Canal de histórico não encontrado.', flags: 64 });
    }
    let encontrado = null;
    try {
      const msgs = await canalHistorico.messages.fetch({ limit: 100 });
      msgs.forEach(msg => {
        if (msg.embeds && msg.embeds.length > 0) {
          const embed = msg.embeds[0];
          const idField = embed.fields?.find(f => f.name === 'ID');
          if (idField && idField.value === id) {
            encontrado = embed;
          }
        }
      });
    } catch (err) {
      return interaction.reply({ content: 'Erro ao buscar histórico.', flags: 64 });
    }
    if (encontrado) {
      return interaction.reply({
        embeds: [encontrado],
        flags: 64
      });
    } else {
      return interaction.reply({ content: `ID ${id} não possui impedimento registrado.`, flags: 64 });
    }
  }
};
