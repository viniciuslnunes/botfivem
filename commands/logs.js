const { SlashCommandBuilder } = require('discord.js');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../utils/permissoes');
const { PERIODO_CHOICES, resolverPeriodo } = require('../utils/logsJogo/estatisticas');
const { abrirConsulta, resolverIdFivem, autocompletarFiltro } = require('../utils/logsJogo/consultas');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Consulta os logs do jogo com filtros (liderança)')
    .addStringOption(o => o.setName('periodo').setDescription('Período (padrão: últimos 7 dias)').addChoices(...PERIODO_CHOICES))
    .addUserOption(o => o.setName('membro').setDescription('Membro do Discord (usa o ID FiveM do apelido)'))
    .addStringOption(o => o.setName('id').setDescription('ID FiveM'))
    .addStringOption(o => o.setName('categoria').setDescription('Categoria do log').setAutocomplete(true))
    .addStringOption(o => o.setName('acao').setDescription('Ação registrada').setAutocomplete(true))
    .addStringOption(o => o.setName('texto').setDescription('Busca livre no texto do log').setMaxLength(80)),

  async execute(interaction) {
    if (!ehLideranca(interaction.member)) {
      return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    }
    const alvo = await resolverIdFivem(interaction);
    if (alvo.erro) return interaction.reply({ content: alvo.erro, flags: 64 });

    const periodo = resolverPeriodo(interaction.options.getString('periodo') ?? '7d');
    const categoria = interaction.options.getString('categoria');
    const acao = interaction.options.getString('acao');
    const texto = interaction.options.getString('texto');

    const rotulo = [
      periodo.rotulo.toLowerCase(),
      alvo.rotulo,
      categoria && `categoria ${categoria}`,
      acao && `ação ${acao}`,
      texto && `"${texto}"`,
    ].filter(Boolean).join(' · ');

    await interaction.deferReply({ flags: 64 });
    await abrirConsulta(interaction, {
      inicio: periodo.inicio,
      fim: periodo.fim,
      idFivem: alvo.idFivem,
      categoria,
      acao,
      texto,
    }, rotulo);
  },

  autocomplete: autocompletarFiltro,
};
