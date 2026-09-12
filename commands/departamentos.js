const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../utils/permissoes');
const { listarDepartamentos } = require('../utils/departamentos/repositorio');
const { mudarArea } = require('../utils/departamentos/gestao');
const { montarEstruturaDepartamentos } = require('../utils/departamentos/setup');
const { atualizarQuadroDepartamentos } = require('../utils/departamentos/quadro');

const opcaoArea = o => o.setName('area').setDescription('Área da torcida').setRequired(true).setAutocomplete(true);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('departamentos')
    .setDescription('Áreas da torcida: estrutura e integrantes')
    .addSubcommand(s => s.setName('incluir').setDescription('Inclui um sócio numa área (gestor da área ou presidência)')
      .addUserOption(o => o.setName('membro').setDescription('Sócio').setRequired(true))
      .addStringOption(opcaoArea)
      .addStringOption(o => o.setName('papel').setDescription('Padrão: membro')
        .addChoices({ name: 'Membro', value: 'membro' }, { name: 'Gestor', value: 'gestor' })))
    .addSubcommand(s => s.setName('remover').setDescription('Remove alguém de uma área (gestor da área ou presidência)')
      .addUserOption(o => o.setName('membro').setDescription('Integrante').setRequired(true))
      .addStringOption(opcaoArea))
    .addSubcommand(s => s.setName('quadro').setDescription('Atualiza o quadro de departamentos'))
    .addSubcommand(s => s.setName('setup').setDescription('Cria ou verifica cargos e canais das áreas (administrador)')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'setup') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ APENAS ADMINISTRADORES PODEM MONTAR A ESTRUTURA DOS DEPARTAMENTOS.', flags: 64 });
      }
      await interaction.deferReply({ flags: 64 });
      const resumo = await montarEstruturaDepartamentos(interaction.guild);
      await atualizarQuadroDepartamentos(interaction.client)
        .catch(err => console.error('[departamentos] Erro ao atualizar quadro:', err));
      return interaction.editReply({ content: `🏛️ **ESTRUTURA DOS DEPARTAMENTOS VERIFICADA**\n${resumo.join('\n')}` });
    }

    if (sub === 'quadro') {
      if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
      await interaction.deferReply({ flags: 64 });
      await atualizarQuadroDepartamentos(interaction.client);
      return interaction.editReply({ content: '🦅 QUADRO DE DEPARTAMENTOS ATUALIZADO.' });
    }

    // incluir / remover: a permissão depende da área, conferida em mudarArea
    await interaction.deferReply({ flags: 64 });
    const mensagem = await mudarArea(interaction, {
      acao: sub,
      slug: interaction.options.getString('area'),
      usuario: interaction.options.getUser('membro'),
      papel: interaction.options.getString('papel') ?? 'membro',
    });
    return interaction.editReply({ content: mensagem, allowedMentions: { parse: [] } });
  },

  async autocomplete(interaction) {
    const busca = String(interaction.options.getFocused() ?? '').toLowerCase();
    const areas = await listarDepartamentos({ apenasAtivos: true });
    return interaction.respond(
      areas
        .filter(a => a.nome.toLowerCase().includes(busca) || a.slug.includes(busca))
        .slice(0, 25)
        .map(a => ({ name: `${a.emoji} ${a.nome}`, value: a.slug }))
    );
  },
};
