const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../utils/permissoes');
const { obterLink, enviarConvitePara } = require('../utils/recrutamento/conviteWhatsapp');
const { garantirMembrosCarregados } = require('../utils/membrosGuild');

// Pequeno intervalo entre DMs para não esbarrar em rate limit do Discord.
const INTERVALO_MS = 400;
const aguardar = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('convitewhatsapp')
    .setDescription('Reenvia por DM o convite do grupo de sócios no WhatsApp para todo mundo com cargo de sócio pra cima')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!ehLideranca(interaction.member)) {
      return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    }
    await interaction.deferReply({ flags: 64 });

    await garantirMembrosCarregados(interaction.guild);
    const link = await obterLink();
    const membros = [...interaction.guild.members.cache.values()].filter(m => !m.user.bot);

    let enviados = 0;
    let falharam = 0;
    let semCargo = 0;
    for (const membro of membros) {
      const resultado = await enviarConvitePara(membro, link);
      if (resultado === 'enviado') enviados++;
      else if (resultado === 'falhou') falharam++;
      else semCargo++;
      await aguardar(INTERVALO_MS);
    }

    await interaction.editReply({
      content: `📞 CONVITE DO WHATSAPP ENVIADO.\n✅ ${enviados} DM(s) enviada(s) com sucesso.\n⚠️ ${falharam} com DM fechada (não recebeu).\n(${semCargo} membros ignorados por não terem cargo de sócio pra cima.)`
    });
  },
};
