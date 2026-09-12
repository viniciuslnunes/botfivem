const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Com área pretendida, o recrutador também pode aprovar sem colocar a pessoa na área
function botoesRecrutamento(comArea = false) {
  const linha = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('aprovar_recrutamento')
      .setLabel('Aprovar')
      .setStyle(ButtonStyle.Secondary)
  );
  if (comArea) {
    linha.addComponents(
      new ButtonBuilder()
        .setCustomId('aprovar_recrutamento_sem_area')
        .setLabel('Aprovar sem área')
        .setStyle(ButtonStyle.Secondary)
    );
  }
  linha.addComponents(
    new ButtonBuilder()
      .setCustomId('reprovar_recrutamento')
      .setLabel('Reprovar')
      .setStyle(ButtonStyle.Danger)
  );
  return [linha];
}

module.exports = { botoesRecrutamento };
