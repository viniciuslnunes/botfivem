const { SlashCommandBuilder } = require('discord.js');
const config = require('../config/index.js');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../utils/permissoes');
const { PERIODO_CHOICES, resolverPeriodo } = require('../utils/logsJogo/estatisticas');
const { resolverIdFivem, autocompletarFiltro } = require('../utils/logsJogo/consultas');
const relatorios = require('../utils/logsJogo/relatorios');
const { montarEmbedFunil } = require('../utils/recrutamento/funilRelatorio');

const opcaoPeriodo = o => o.setName('periodo').setDescription('Período (padrão: últimos 7 dias)').addChoices(...PERIODO_CHOICES);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('estatisticas')
    .setDescription('Estatísticas dos logs do jogo (liderança)')
    .addSubcommand(s => s.setName('torcida').setDescription('Visão geral da torcida').addStringOption(opcaoPeriodo))
    .addSubcommand(s => s.setName('membro').setDescription('Atividade de um membro')
      .addUserOption(o => o.setName('membro').setDescription('Membro do Discord (usa o ID FiveM do apelido)'))
      .addStringOption(o => o.setName('id').setDescription('ID FiveM'))
      .addStringOption(opcaoPeriodo))
    .addSubcommand(s => s.setName('categoria').setDescription('Uma categoria de log')
      .addStringOption(o => o.setName('categoria').setDescription('Categoria').setRequired(true).setAutocomplete(true))
      .addStringOption(opcaoPeriodo))
    .addSubcommand(s => s.setName('inativos').setDescription('Sócios sem atividade no jogo')
      .addIntegerOption(o => o.setName('dias').setDescription(`Dias sem atividade (padrão: ${config.logsJogo.inatividadeDias})`).setMinValue(1).setMaxValue(90)))
    .addSubcommand(s => s.setName('recrutamento').setDescription('Funil: entrou no jogo → pediu recrutamento → aprovado')
      .addStringOption(o => o.setName('periodo').setDescription('Período (padrão: últimos 30 dias)').addChoices(...PERIODO_CHOICES))),

  async execute(interaction) {
    if (!ehLideranca(interaction.member)) {
      return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    }
    const sub = interaction.options.getSubcommand();
    const periodo = resolverPeriodo(interaction.options.getString('periodo') ?? (sub === 'recrutamento' ? '30d' : '7d'));

    let alvo = null;
    if (sub === 'membro') {
      alvo = await resolverIdFivem(interaction);
      if (alvo.erro) return interaction.reply({ content: alvo.erro, flags: 64 });
      if (!alvo.idFivem) return interaction.reply({ content: '❌ INFORME UM MEMBRO OU UM ID FIVEM.', flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });

    let embed;
    if (sub === 'torcida') embed = await relatorios.montarEmbedTorcida(periodo);
    else if (sub === 'membro') embed = await relatorios.montarEmbedMembro(alvo.idFivem, alvo.rotulo, periodo);
    else if (sub === 'categoria') embed = await relatorios.montarEmbedCategoria(interaction.options.getString('categoria'), periodo);
    else if (sub === 'recrutamento') embed = await montarEmbedFunil(interaction.guild, periodo);
    else embed = await relatorios.montarEmbedInativos(interaction.guild, interaction.options.getInteger('dias') ?? config.logsJogo.inatividadeDias);

    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },

  autocomplete: autocompletarFiltro,
};
