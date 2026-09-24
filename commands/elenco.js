const { SlashCommandBuilder } = require('discord.js');
const config = require('../config/index.js');
const tema = require('../tema');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('elenco')
    .setDescription(`Lista todos os membros do elenco ${tema.marca.elenco.sigla} com o cargo específico.`),
  async execute(interaction) {
    const cargoRsj = config.cargos.elenco; // sub-marca do elenco (tema.marca.elenco)

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
      return interaction.editReply(`Nenhum membro encontrado no elenco ${tema.marca.elenco.sigla}.`);
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
        color: tema.cor.primaria,
        title: tema.marca.elenco.titulo,
        description: desc,
        footer: { text: `Total: ${membros.size} membros` },
        image: { url: tema.urlAnexo(tema.marca.elenco.logo) }
      }],
      files: [tema.anexo(tema.marca.elenco.logo)],
      allowedMentions: { users: [] }
    });
  }
};
