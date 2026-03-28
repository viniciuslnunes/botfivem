const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('testenick')
    .setDescription('Testa alteração de nick de um usuário')
    .addUserOption(option =>
      option.setName('usuario')
        .setDescription('Usuário para alterar o nick')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('nick')
        .setDescription('Novo nick')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const user = interaction.options.getUser('usuario');
    const nick = interaction.options.getString('nick');
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return interaction.reply({ content: 'Usuário não encontrado.', flags: 64 });
    try {
      await member.setNickname(nick);
      await interaction.reply({ content: `✅ Nick alterado para <@${user.id}>: ${nick}`, flags: 64 });
    } catch (err) {
      await interaction.reply({ content: `❌ Erro ao alterar nick: ${err.message}`, flags: 64 });
    }
  }
};
