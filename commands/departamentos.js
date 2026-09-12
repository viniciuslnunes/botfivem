const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { montarEstruturaDepartamentos } = require('../utils/departamentos/setup');
const { atualizarQuadroDepartamentos } = require('../utils/departamentos/quadro');
require('../utils/departamentos/interacoes'); // registra os botões incluir/remover/atualizar quadro

// Incluir, remover e atualizar o quadro viraram botões nos próprios canais de
// área (e no canal do quadro) — só o bootstrap (criar cargos/canais) continua
// sendo comando, porque nada existe ainda para um botão aparecer nele.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('departamentos')
    .setDescription('Cria ou verifica cargos e canais das áreas da torcida (administrador)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ APENAS ADMINISTRADORES PODEM MONTAR A ESTRUTURA DOS DEPARTAMENTOS.', flags: 64 });
    }
    await interaction.deferReply({ flags: 64 });
    const resumo = await montarEstruturaDepartamentos(interaction.guild);
    await atualizarQuadroDepartamentos(interaction.client)
      .catch(err => console.error('[departamentos] Erro ao atualizar quadro:', err));
    return interaction.editReply({ content: `🏛️ **ESTRUTURA DOS DEPARTAMENTOS VERIFICADA**\n${resumo.join('\n')}` });
  },
};
