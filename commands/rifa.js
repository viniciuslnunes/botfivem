const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { registrarLogGestao } = require('../utils/logGestao');
const { parseDataHora } = require('../utils/eventos/regras');
const { formatarNumero } = require('../utils/logsJogo/estatisticas');
const repo = require('../utils/rifas/repositorio');
const R = require('../utils/rifas/regras');
const { atualizarMensagemRifa } = require('../utils/rifas/mensagem');
const { montarEstruturaRifas } = require('../utils/rifas/estrutura');
const { podeGerirRifas } = require('../utils/rifas/permissoes');
const G = require('../utils/rifas/gestao');
require('../utils/rifas/interacoes'); // registra botões, modais e tarefas da rifa

const { MSG_SEM_GESTAO } = G;
const MSG_NAO_ENCONTRADA = '❌ RIFA NÃO ENCONTRADA.';
const unix = d => Math.floor(new Date(d).getTime() / 1000);

async function marcarSorteio(interaction) {
  if (!(await podeGerirRifas(interaction.member))) return interaction.reply({ content: MSG_SEM_GESTAO, flags: 64 });
  const data = parseDataHora(interaction.options.getString('data'));
  if (!data) return interaction.reply({ content: '❌ DATA INVÁLIDA. USE `DD/MM HH:MM`.', flags: 64 });
  if (data.getTime() <= Date.now()) return interaction.reply({ content: '❌ A DATA DO SORTEIO JÁ PASSOU.', flags: 64 });

  await interaction.deferReply({ flags: 64 });
  const r = await repo.marcarSorteio(interaction.options.getInteger('id'), data);
  if (r.erro === 'limiar') {
    return interaction.editReply({ content: `⏳ A DATA DO SORTEIO SÓ É DIVULGADA AO ATINGIR ${r.pct}% DOS NÚMEROS VENDIDOS. FALTAM **${formatarNumero(r.faltam)} NÚMEROS**.` });
  }
  if (r.erro === 'fechada') return interaction.editReply({ content: '❌ ESTA RIFA JÁ FOI SORTEADA OU CANCELADA.' });
  if (r.erro) return interaction.editReply({ content: MSG_NAO_ENCONTRADA });

  await atualizarMensagemRifa(interaction.client, r.rifa.id).catch(err => console.error('[rifas] Erro ao atualizar mensagem:', err));
  await registrarLogGestao(interaction.client, {
    titulo: `📅 RIFA #${r.rifa.id} — DATA DO SORTEIO DIVULGADA`,
    ator: interaction.user.id,
    campos: [{ name: 'SORTEIO', value: `<t:${unix(data)}:F>`, inline: true }],
  });
  return interaction.editReply({ content: `📅 SORTEIO DA RIFA #${r.rifa.id} MARCADO PARA <t:${unix(data)}:F>. A MENSAGEM DA RIFA FOI ATUALIZADA.` });
}

async function setup(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ APENAS ADMINISTRADORES MONTAM A ESTRUTURA DAS RIFAS.', flags: 64 });
  }
  await interaction.deferReply({ flags: 64 });
  const resumo = await montarEstruturaRifas(interaction.guild);
  return interaction.editReply({ content: `🎟️ **ESTRUTURA DAS RIFAS VERIFICADA**\n${resumo.join('\n')}` });
}

const opcaoId = o => o.setName('id').setDescription('Rifa').setRequired(true).setAutocomplete(true);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rifa')
    .setDescription('Rifas da torcida (dinheiro do jogo)')
    .addSubcommand(s => s.setName('criar').setDescription('Publica uma rifa no canal de rifas (presidência ou gestor de Social e Eventos)')
      .addStringOption(o => o.setName('titulo').setDescription('Título').setRequired(true).setMaxLength(80))
      .addStringOption(o => o.setName('premio').setDescription('O que o vencedor leva').setRequired(true).setMaxLength(300))
      .addStringOption(o => o.setName('preco').setDescription('Preço por número (ex.: 500)').setRequired(true))
      .addIntegerOption(o => o.setName('numeros').setDescription(`Quantidade de números (${R.MIN_NUMEROS} a ${R.MAX_NUMEROS})`).setRequired(true)
        .setMinValue(R.MIN_NUMEROS).setMaxValue(R.MAX_NUMEROS))
      .addStringOption(o => o.setName('sorteio').setDescription('Padrão: sorteio pelo bot (auditável)').addChoices(...R.METODO_CHOICES))
      .addStringOption(o => o.setName('encerra').setDescription('Fim das vendas: DD/MM HH:MM (vazio = encerrar à mão)'))
      .addIntegerOption(o => o.setName('limite').setDescription('Números por pessoa (padrão: 10% da rifa)').setMinValue(1).setMaxValue(R.MAX_NUMEROS))
      .addStringOption(o => o.setName('nao_vendido').setDescription('Sorteio ao vivo: se sair número não vendido').addChoices(...R.REGRA_NAO_VENDIDO_CHOICES))
      .addStringOption(o => o.setName('custo_premio').setDescription('Quanto a torcida gastou no prêmio (para calcular a sobra)'))
      .addAttachmentOption(o => o.setName('imagem').setDescription('Foto do prêmio'))
      .addStringOption(o => o.setName('descricao').setDescription('Descrição / regulamento').setMaxLength(1000)))
    .addSubcommand(s => s.setName('lista').setDescription('Rifas em andamento'))
    .addSubcommand(s => s.setName('encerrar').setDescription('Encerra as vendas de uma rifa').addIntegerOption(opcaoId))
    .addSubcommand(s => s.setName('marcar-sorteio').setDescription('Divulga a data do sorteio (só com 70% vendidos)')
      .addIntegerOption(opcaoId)
      .addStringOption(o => o.setName('data').setDescription('Data e hora: DD/MM HH:MM').setRequired(true)))
    .addSubcommand(s => s.setName('sortear').setDescription('Sorteia uma rifa encerrada')
      .addIntegerOption(opcaoId)
      .addIntegerOption(o => o.setName('numero').setDescription('Sorteio ao vivo: número sorteado').setMinValue(1).setMaxValue(R.MAX_NUMEROS))
      .addAttachmentOption(o => o.setName('evidencia').setDescription('Sorteio ao vivo: foto do sorteio'))
      .addStringOption(o => o.setName('link').setDescription('Sorteio ao vivo: link da live ou do vídeo').setMaxLength(300)))
    .addSubcommand(s => s.setName('cancelar').setDescription('Cancela a rifa e avisa quem comprou')
      .addIntegerOption(opcaoId)
      .addStringOption(o => o.setName('motivo').setDescription('Vai para os compradores').setRequired(true).setMaxLength(300)))
    .addSubcommand(s => s.setName('relatorio').setDescription('Vendas, pendências e sobra de uma rifa').addIntegerOption(opcaoId))
    .addSubcommand(s => s.setName('setup').setDescription('Cria o canal de conferência de pagamentos (administrador)')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const id = () => interaction.options.getInteger('id');
    const texto = k => interaction.options.getString(k);
    if (sub === 'criar') {
      return G.criar(interaction, {
        titulo: texto('titulo'), premio: texto('premio'), preco: texto('preco'),
        numeros: interaction.options.getInteger('numeros'), descricao: texto('descricao'),
        custoPremio: texto('custo_premio'), limite: interaction.options.getInteger('limite'),
        sorteio: texto('sorteio'), naoVendido: texto('nao_vendido'), encerra: texto('encerra'),
        anexo: interaction.options.getAttachment('imagem'),
      });
    }
    if (sub === 'lista') return G.lista(interaction);
    if (sub === 'encerrar') return G.encerrar(interaction, id());
    if (sub === 'marcar-sorteio') return marcarSorteio(interaction);
    if (sub === 'sortear') {
      return G.sortear(interaction, id(), {
        numero: interaction.options.getInteger('numero'), link: texto('link'), anexo: interaction.options.getAttachment('evidencia'),
      });
    }
    if (sub === 'cancelar') return G.cancelar(interaction, id(), texto('motivo'));
    if (sub === 'relatorio') return G.relatorio(interaction, id());
    return setup(interaction);
  },

  async autocomplete(interaction) {
    const busca = String(interaction.options.getFocused() ?? '').toLowerCase();
    const status = {
      encerrar: ['ABERTA'],
      'marcar-sorteio': ['ABERTA', 'ENCERRADA'],
      sortear: ['ENCERRADA'],
      cancelar: ['ABERTA', 'ENCERRADA'],
    }[interaction.options.getSubcommand()] ?? null;
    const rifas = await repo.listarRifas({ status, limite: 25 });
    return interaction.respond(rifas
      .filter(r => r.titulo.toLowerCase().includes(busca) || String(r.id).startsWith(busca))
      .map(r => ({ name: `#${r.id} ${r.titulo} (${R.STATUS_RIFA[r.status].rotulo})`.slice(0, 100), value: Number(r.id) })));
  },
};
