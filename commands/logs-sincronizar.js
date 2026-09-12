const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../utils/permissoes');
const { sincronizarCanaisDeLog } = require('../utils/logsJogo/ingestao');
const { formatarNumero } = require('../utils/logsJogo/estatisticas');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logs-sincronizar')
    .setDescription('Lê o histórico dos canais de log do jogo e grava o que faltar')
    .addBooleanOption(o => o.setName('completo').setDescription('Reler o histórico inteiro (padrão: só o que falta)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!ehLideranca(interaction.member)) {
      return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    }
    await interaction.deferReply({ flags: 64 });

    const completo = interaction.options.getBoolean('completo') ?? false;
    const resultados = await sincronizarCanaisDeLog(interaction.client, { completo });
    const linhas = resultados.map(r => r.erro
      ? `❌ <#${r.canalId}> — ${r.erro}`
      : `🦅 <#${r.canalId}> — ${formatarNumero(r.lidas)} mensagens lidas, ${formatarNumero(r.novas)} logs novos gravados`);

    await interaction.editReply({ content: `**SINCRONIZAÇÃO ${completo ? 'COMPLETA' : 'INCREMENTAL'} CONCLUÍDA**\n${linhas.join('\n')}` });
  },
};
