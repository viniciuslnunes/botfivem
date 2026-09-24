const { SlashCommandBuilder } = require('discord.js');
const config = require('../config/index.js');
const tema = require('../tema');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../utils/permissoes');
const { montarStatus, coletarStatus } = require('../utils/status');
const { version } = require('../package.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Saúde do bot: banco, tarefas, módulos e fontes de log (liderança)'),

  async execute(interaction) {
    if (!ehLideranca(interaction.member)) {
      return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    }
    await interaction.deferReply({ flags: 64 });
    const plataforma = require('../plataforma');
    const dados = await coletarStatus({ tenant: config, plataforma, versao: version });
    const { linhas, problemas } = montarStatus(dados);
    const resumo = problemas === 0 ? `${tema.emoji.ok} **TUDO EM DIA.**` : `${tema.emoji.recusado} **${problemas} ITEM(NS) PRECISAM DE ATENÇÃO.**`;
    return interaction.editReply({
      embeds: [{ color: tema.cor.primaria, title: tema.titulo('STATUS DO BOT'), description: [resumo, '', ...linhas].join('\n') }],
    });
  },
};
