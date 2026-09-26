const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { montarEstruturaSorteios, garantirPainelNoFim } = require('../utils/sorteios/estrutura');
const repo = require('../utils/sorteios/repositorio');
const { podeGerirRifas } = require('../utils/rifas/permissoes');
const { idFivemDoNick } = require('../utils/logsJogo/estatisticas');
const tema = require('../tema');
require('../utils/sorteios/interacoes'); // registra botões, selects e modais do sorteio
require('../utils/sorteios/tarefas'); // lembrete de prêmio por entregar

async function estrutura(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ SÓ ADMINISTRADORES USAM ESTE COMANDO.', flags: 64 });
  }
  await interaction.deferReply({ flags: 64 });
  const resumo = await montarEstruturaSorteios(interaction.guild);
  await garantirPainelNoFim(interaction.client);
  return interaction.editReply({ content: `${tema.emoji.ok} **ESTRUTURA DOS SORTEIOS**\n${resumo.join('\n')}` });
}

// Cada um vê os próprios prêmios; ver os de outra pessoa é da gestão dos sorteios
async function ganhos(interaction) {
  const alvo = interaction.options.getUser('membro');
  if (alvo && alvo.id !== interaction.user.id && !(await podeGerirRifas(interaction.member))) {
    return interaction.reply({ content: '❌ SÓ A GESTÃO DOS SORTEIOS VÊ OS PRÊMIOS DE OUTRA PESSOA.', flags: 64 });
  }
  const id = alvo?.id ?? interaction.user.id;
  const membro = await interaction.guild.members.fetch(id).catch(() => null);
  const idJogo = idFivemDoNick(membro?.nickname ?? membro?.displayName);
  const lista = await repo.premiosGanhos({ discordId: id, idJogo });
  const linhas = lista.map(g => `🎁 **${g.descricao}** — sorteio #${g.sorteio_id} ${g.titulo} · <t:${Math.floor(new Date(g.concluido_em).getTime() / 1000)}:d> · ${g.entregue_em ? '📦 entregue' : `${tema.emoji.pendente} a entregar`}`);
  return interaction.reply({
    embeds: [{
      color: tema.cor.primaria,
      title: tema.tituloSegmentado('🎁 PRÊMIOS GANHOS'),
      description: linhas.join('\n') || '*Nenhum prêmio em sorteio concluído.*',
      footer: { text: `${membro?.displayName ?? id} · últimos ${lista.length}` },
    }],
    allowedMentions: { parse: [] },
    flags: 64,
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sorteio')
    .setDescription('Sorteio de brindes entre quem colou no dia')
    .addSubcommand(s => s.setName('estrutura').setDescription('Cria os canais de sorteios e de histórico e posta o botão de novo sorteio (administrador)'))
    .addSubcommand(s => s.setName('ganhos').setDescription('Prêmios ganhos em sorteios (os seus; a gestão vê os de outra pessoa)')
      .addUserOption(o => o.setName('membro').setDescription('Quem consultar (vazio = você)'))),

  async execute(interaction) {
    if (interaction.options.getSubcommand() === 'ganhos') return ganhos(interaction);
    return estrutura(interaction);
  },
};
