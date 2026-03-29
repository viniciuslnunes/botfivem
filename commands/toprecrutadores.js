const { SlashCommandBuilder } = require('discord.js');
const db = require('../utils/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('toprecrutadores')
    .setDescription('Exibe o ranking dos que mais aprovaram recrutamentos'),
  async execute(interaction) {
    // Consulta ranking no banco
    const result = await db.query(
      'SELECT aprovador_id, COUNT(*) as total FROM aprovacoes_recrutamento GROUP BY aprovador_id ORDER BY total DESC LIMIT 25'
    );
    const rows = result.rows;
    if (!rows.length) {
      return interaction.reply('Nenhuma aprovação registrada ainda.');
    }
    // Monta ranking
    let desc = '';
    for (let i = 0; i < rows.length; i++) {
      const { aprovador_id, total } = rows[i];
      desc += `${i + 1}. <@${aprovador_id}> — **${total} aprovações**\n`;
    }
    await interaction.reply({
      embeds: [{
        color: 0xF1C40F,
        title: '🏆 Top Recrutadores',
        description: desc
      }],
      allowedMentions: { users: [] }
    });
  }
};
