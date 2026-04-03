const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('elenco')
    .setDescription('Lista todos os membros do elenco [R.S.J] com o cargo específico.'),
  async execute(interaction) {
    const cargoRsj = '1489461786511020285'; // [R.S.J] RUA SÃO JORGE

    // Adia imediatamente para evitar expiração da interação
    await interaction.deferReply();

    try {
      // Busca todos os membros (requer GuildMembers intent)
      await interaction.guild.members.fetch({ withPresences: false, force: true });
    } catch (err) {
      console.error('[elenco] Erro ao buscar membros:', err);
    }

    const membros = interaction.guild.members.cache.filter(member =>
      member.roles.cache.has(cargoRsj)
    );

    if (!membros.size) {
      return interaction.editReply('Nenhum membro encontrado no elenco [R.S.J].');
    }

    let desc = '';
    let i = 1;
    membros.forEach(member => {
      desc += `${i++}. <@${member.id}>\n`;
    });

    // Discord limita embed description a 4096 caracteres
    if (desc.length > 4096) {
      desc = desc.substring(0, 4093) + '...';
    }

    await interaction.editReply({
      embeds: [{
        color: 0x000000,
        title: '🦅・[R.S.J] RUA SÃO JORGE - ELENCO',
        description: desc,
        footer: { text: `Total: ${membros.size} membros` },
        image: { url: 'attachment://ruasaojorge.png' }
      }],
      files: [{ attachment: './img/ruasaojorge.png', name: 'ruasaojorge.png' }],
      allowedMentions: { users: [] }
    });
  }
};
