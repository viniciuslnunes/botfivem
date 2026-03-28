const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = [
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('aprovar_recrutamento')
      .setLabel('Aprovar')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('reprovar_recrutamento')
      .setLabel('Reprovar')
      .setStyle(ButtonStyle.Danger)
  )
];
