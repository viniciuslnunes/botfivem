const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config/index.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('testesocio')
    .setDescription('Testa atribuição do cargo de sócio para um usuário')
    .addUserOption(option =>
      option.setName('usuario')
        .setDescription('Usuário para receber o cargo')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const user = interaction.options.getUser('usuario');
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return interaction.reply({ content: 'Usuário não encontrado.', flags: 64 });
    try {
      console.log('DEBUG - ID do cargo SÓCIO:', config.cargos.socio, typeof config.cargos.socio);
      await member.roles.add(config.cargos.socio);
      await interaction.reply({ content: `🦅 Cargo de sócio atribuído para <@${user.id}>!`, flags: 64 });
    } catch (err) {
      await interaction.reply({ content: `❌ Erro ao atribuir cargo: ${err.message}`, flags: 64 });
    }
  }
};
