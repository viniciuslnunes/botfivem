const { SlashCommandBuilder } = require('discord.js');
const db = require('../utils/db');
const tema = require('../tema');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('toprecrutadores')
    .setDescription('Exibe o ranking dos que mais aprovaram recrutamentos'),
  async execute(interaction) {
    await interaction.deferReply();
    // Consulta ranking no banco
    const result = await db.query(
      'SELECT aprovador_id, COUNT(*) as total FROM aprovacoes_recrutamento GROUP BY aprovador_id ORDER BY total DESC LIMIT 25'
    );
    const rows = result.rows;
    if (!rows.length) {
      return interaction.editReply({ content: 'NENHUMA APROVAÇÃO REGISTRADA AINDA.' });
    }
    // Monta ranking
    let desc = '';
    for (let i = 0; i < rows.length; i++) {
      const { aprovador_id, total } = rows[i];
      desc += `${i + 1}. <@${aprovador_id}> — **${total} APROVAÇÕES**\n`;
    }
    await interaction.editReply({
      embeds: [{
        color: tema.cor.primaria,
        title: '🏆 TOP RECRUTADORES',
        description: desc
      }],
      allowedMentions: { users: [] }
    });
  }
};
