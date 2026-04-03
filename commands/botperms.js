const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('botperms')
        .setDescription('Diagnóstico de permissões e hierarquia do bot')
        .addUserOption(option =>
            option.setName('usuario')
                .setDescription('Usuário para checar permissões')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        const botMember = interaction.guild.members.me;
        const botHighestRole = botMember.roles.highest;
        const perms = botMember.permissions;
        const canManageRoles = perms.has(PermissionFlagsBits.ManageRoles);
        const canManageNicknames = perms.has(PermissionFlagsBits.ManageNicknames);
        const isAdmin = perms.has(PermissionFlagsBits.Administrator);

        let msg = `**Diagnóstico do Bot:**\n`;
        msg += `• Cargo mais alto: ${botHighestRole} (ID: ${botHighestRole.id})\n`;
        msg += `• Gerenciar cargos: ${canManageRoles ? '🦅' : '❌'}\n`;
        msg += `• Gerenciar apelidos: ${canManageNicknames ? '🦅' : '❌'}\n`;
        msg += `• Administrador: ${isAdmin ? '🦅' : '❌'}\n`;

        const user = interaction.options.getUser('usuario');
        if (user) {
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (!member) {
                msg += `\nUsuário não encontrado no servidor.`;
            } else {
                const userHighestRole = member.roles.highest;
                msg += `\n**Usuário alvo:**\n`;
                msg += `• Cargo mais alto: ${userHighestRole} (ID: ${userHighestRole.id})\n`;
                msg += `• Bot pode alterar nick: ${botHighestRole.position > userHighestRole.position ? '🦅' : '❌'}\n`;
                msg += `• Bot pode dar/remover cargo: ${botHighestRole.position > userHighestRole.position ? '🦅' : '❌'}\n`;
            }
        }
        await interaction.reply({ content: msg, flags: 64 });
    }
};
