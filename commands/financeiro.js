const { SlashCommandBuilder } = require('discord.js');
const { ehPresidencia } = require('../utils/permissoes');
const { registrarLogGestao } = require('../utils/logGestao');
const { PERIODO_CHOICES, resolverPeriodo, chaveDia, formatarDinheiro, variacao, truncar } = require('../utils/logsJogo/estatisticas');
const regras = require('../utils/financeiro/regras');
const repo = require('../utils/financeiro/repositorio');
const { podeVerFinanceiro, podeLancarFinanceiro } = require('../utils/financeiro/permissoes');
const eventosRepo = require('../utils/eventos/repositorio');
const { formatarDataBR } = require('../utils/carteirinha/regras');

const MSG_SEM_ACESSO = '❌ O CAIXA É VISTO PELA LIDERANÇA E PELA ÁREA FINANCEIRO.';
const MSG_SEM_LANCAMENTO = '❌ SÓ A PRESIDÊNCIA OU O GESTOR DO FINANCEIRO LANÇA E EXCLUI NO CAIXA.';

function filtroDoPeriodo(periodo) {
  return { inicio: periodo.inicio ? chaveDia(periodo.inicio) : null, fim: chaveDia(periodo.fim) };
}

function dataLancamento(l) {
  return formatarDataBR(l.data instanceof Date ? l.data.toISOString().slice(0, 10) : String(l.data).slice(0, 10));
}

async function lancar(interaction) {
  if (!(await podeLancarFinanceiro(interaction.member))) return interaction.reply({ content: MSG_SEM_LANCAMENTO, flags: 64 });
  const valor = regras.parseValor(interaction.options.getString('valor'));
  if (!valor) return interaction.reply({ content: '❌ VALOR INVÁLIDO. EXEMPLOS: `1500`, `1.500`, `2500,50`.', flags: 64 });
  const data = regras.parseDataLancamento(interaction.options.getString('data'));
  if (!data) return interaction.reply({ content: '❌ DATA INVÁLIDA. USE `DD/MM` OU `DD/MM/AAAA` (ATÉ 1 ANO À FRENTE).', flags: 64 });

  const eventoId = interaction.options.getInteger('evento');
  if (eventoId && !(await eventosRepo.buscarEvento(eventoId))) {
    return interaction.reply({ content: '❌ EVENTO NÃO ENCONTRADO.', flags: 64 });
  }
  await interaction.deferReply({ flags: 64 });
  const l = await repo.lancar({
    tipo: interaction.options.getString('tipo'),
    categoria: interaction.options.getString('categoria'),
    valor,
    descricao: interaction.options.getString('descricao'),
    data,
    eventoId,
    origem: 'MANUAL',
    criadoPorId: interaction.user.id,
  });
  await registrarLogGestao(interaction.client, {
    titulo: `💰 LANÇAMENTO #${l.id} — ${l.tipo}`,
    ator: interaction.user.id,
    cor: 0x000000,
    campos: [
      { name: 'VALOR', value: formatarDinheiro(l.valor), inline: true },
      { name: 'CATEGORIA', value: regras.rotuloCategoria(l.categoria), inline: true },
      { name: 'DATA', value: dataLancamento(l), inline: true },
      { name: 'DESCRIÇÃO', value: truncar(l.descricao, 1000), inline: false },
    ],
  });
  return interaction.editReply({ content: `🦅 LANÇAMENTO #${l.id} REGISTRADO: ${l.tipo === 'RECEITA' ? '➕' : '➖'} ${formatarDinheiro(l.valor)} · ${regras.rotuloCategoria(l.categoria)}.` });
}

async function extrato(interaction) {
  if (!(await podeVerFinanceiro(interaction.member))) return interaction.reply({ content: MSG_SEM_ACESSO, flags: 64 });
  await interaction.deferReply({ flags: 64 });
  const periodo = resolverPeriodo(interaction.options.getString('periodo') ?? '30d');
  const filtro = { ...filtroDoPeriodo(periodo), tipo: interaction.options.getString('tipo'), categoria: interaction.options.getString('categoria') };
  const [lancamentos, totais] = await Promise.all([repo.listarLancamentos(filtro, 25), repo.totaisPorCategoria(filtro)]);
  const resumo = regras.resumirLancamentos(totais);
  const linhas = lancamentos.map(l =>
    `\`#${l.id}\` ${dataLancamento(l)} · ${l.tipo === 'RECEITA' ? '➕' : '➖'} **${formatarDinheiro(l.valor)}** · ${regras.rotuloCategoria(l.categoria)} · ${truncar(l.descricao, 60)}${l.origem !== 'MANUAL' ? ` · _${l.origem.toLowerCase()}_` : ''}`);
  return interaction.editReply({
    embeds: [{
      color: 0x000000,
      title: `💰 EXTRATO — ${periodo.rotulo}`,
      description: truncar(linhas.join('\n') || '*Nenhum lançamento no período.*', 4096),
      fields: [
        { name: 'RECEITAS', value: formatarDinheiro(resumo.receitas), inline: true },
        { name: 'DESPESAS', value: formatarDinheiro(resumo.despesas), inline: true },
        { name: 'SALDO', value: formatarDinheiro(resumo.saldo), inline: true },
      ],
      footer: { text: lancamentos.length === 25 ? 'Mostrando os 25 mais recentes · totais consideram o período inteiro' : 'Dinheiro do jogo' },
    }],
  });
}

async function montarBalanco(periodo, nivel) {
  const atual = regras.resumirLancamentos(await repo.totaisPorCategoria(filtroDoPeriodo(periodo)));
  const anterior = periodo.anteriorInicio
    ? regras.resumirLancamentos(await repo.totaisPorCategoria({ inicio: chaveDia(periodo.anteriorInicio), fim: chaveDia(periodo.anteriorFim) }))
    : null;
  const fields = [
    { name: 'RECEITAS', value: `${formatarDinheiro(atual.receitas)}${anterior ? `\n${variacao(atual.receitas, anterior.receitas)}` : ''}`, inline: true },
    { name: 'DESPESAS', value: `${formatarDinheiro(atual.despesas)}${anterior ? `\n${variacao(atual.despesas, anterior.despesas)}` : ''}`, inline: true },
    { name: 'SALDO DO PERÍODO', value: formatarDinheiro(atual.saldo), inline: true },
  ];
  if (nivel === 'CATEGORIAS') {
    fields.push({
      name: 'POR CATEGORIA',
      value: atual.porCategoria.length
        ? truncar(atual.porCategoria.map(c => `${regras.rotuloCategoria(c.categoria)} · ➕ ${formatarDinheiro(c.receitas)} · ➖ ${formatarDinheiro(c.despesas)}`).join('\n'), 1024)
        : '*Sem movimentação.*',
      inline: false,
    });
  }
  return { color: 0x000000, title: `💰 BALANÇO — ${periodo.rotulo}`, fields, footer: { text: 'Prestação de contas da torcida · dinheiro do jogo' }, timestamp: new Date().toISOString() };
}

async function balanco(interaction) {
  if (!(await podeVerFinanceiro(interaction.member))) return interaction.reply({ content: MSG_SEM_ACESSO, flags: 64 });
  await interaction.deferReply({ flags: 64 });
  const periodo = resolverPeriodo(interaction.options.getString('periodo') ?? '30d');
  return interaction.editReply({ embeds: [await montarBalanco(periodo, 'CATEGORIAS')] });
}

async function publicarBalanco(interaction) {
  if (!ehPresidencia(interaction.member)) return interaction.reply({ content: '❌ SÓ A PRESIDÊNCIA PUBLICA O BALANÇO.', flags: 64 });
  if (!interaction.channel?.isTextBased()) return interaction.reply({ content: '❌ USE NUM CANAL DE TEXTO.', flags: 64 });
  await interaction.deferReply({ flags: 64 });
  const periodo = resolverPeriodo(interaction.options.getString('periodo') ?? '30d');
  const nivel = interaction.options.getString('nivel') ?? 'TOTAIS';
  // Balanço público nunca traz lançamentos individuais nem descrições
  await interaction.channel.send({ embeds: [await montarBalanco(periodo, nivel)] });
  await registrarLogGestao(interaction.client, {
    titulo: '💰 BALANÇO PUBLICADO',
    ator: interaction.user.id,
    campos: [
      { name: 'PERÍODO', value: periodo.rotulo, inline: true },
      { name: 'NÍVEL', value: nivel, inline: true },
      { name: 'CANAL', value: `<#${interaction.channelId}>`, inline: true },
    ],
  });
  return interaction.editReply({ content: '🦅 BALANÇO PUBLICADO NESTE CANAL.' });
}

async function excluir(interaction) {
  if (!(await podeLancarFinanceiro(interaction.member))) return interaction.reply({ content: MSG_SEM_LANCAMENTO, flags: 64 });
  await interaction.deferReply({ flags: 64 });
  const id = interaction.options.getInteger('id');
  const existente = await repo.buscarLancamento(id);
  if (!existente) return interaction.editReply({ content: '❌ LANÇAMENTO NÃO ENCONTRADO.' });
  if (existente.origem !== 'MANUAL') {
    return interaction.editReply({ content: `❌ O LANÇAMENTO #${id} FOI GERADO AUTOMATICAMENTE (${existente.origem}) E SÓ SAI PELO MÓDULO DE ORIGEM.` });
  }
  const apagado = await repo.excluirManual(id);
  // A exclusão é definitiva: o retrato do lançamento fica no log de gestão
  await registrarLogGestao(interaction.client, {
    titulo: `🗑️ LANÇAMENTO #${id} EXCLUÍDO`,
    ator: interaction.user.id,
    cor: 0xFF0000,
    campos: [
      { name: 'TIPO', value: apagado.tipo, inline: true },
      { name: 'VALOR', value: formatarDinheiro(apagado.valor), inline: true },
      { name: 'CATEGORIA', value: regras.rotuloCategoria(apagado.categoria), inline: true },
      { name: 'DATA', value: dataLancamento(apagado), inline: true },
      { name: 'DESCRIÇÃO', value: truncar(apagado.descricao, 1000), inline: false },
      { name: 'MOTIVO', value: interaction.options.getString('motivo'), inline: false },
    ],
  });
  return interaction.editReply({ content: `🗑️ LANÇAMENTO #${id} EXCLUÍDO.` });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('financeiro')
    .setDescription('Livro-caixa da torcida (dinheiro do jogo)')
    .addSubcommand(s => s.setName('lancar').setDescription('Registra uma receita ou despesa')
      .addStringOption(o => o.setName('tipo').setDescription('Receita ou despesa').setRequired(true).addChoices(...regras.TIPO_LANCAMENTO_CHOICES))
      .addStringOption(o => o.setName('categoria').setDescription('Categoria').setRequired(true).addChoices(...regras.CATEGORIA_CHOICES))
      .addStringOption(o => o.setName('valor').setDescription('Valor (ex.: 1500 ou 1.500)').setRequired(true))
      .addStringOption(o => o.setName('descricao').setDescription('Do que se trata').setRequired(true).setMaxLength(300))
      .addStringOption(o => o.setName('data').setDescription('DD/MM ou DD/MM/AAAA (padrão: hoje)'))
      .addIntegerOption(o => o.setName('evento').setDescription('Evento/caravana a que o valor pertence').setAutocomplete(true)))
    .addSubcommand(s => s.setName('extrato').setDescription('Lançamentos do período')
      .addStringOption(o => o.setName('periodo').setDescription('Padrão: últimos 30 dias').addChoices(...PERIODO_CHOICES))
      .addStringOption(o => o.setName('tipo').setDescription('Filtrar por tipo').addChoices(...regras.TIPO_LANCAMENTO_CHOICES))
      .addStringOption(o => o.setName('categoria').setDescription('Filtrar por categoria').addChoices(...regras.CATEGORIA_CHOICES)))
    .addSubcommand(s => s.setName('balanco').setDescription('Receitas, despesas e saldo do período')
      .addStringOption(o => o.setName('periodo').setDescription('Padrão: últimos 30 dias').addChoices(...PERIODO_CHOICES)))
    .addSubcommand(s => s.setName('publicar-balanco').setDescription('Publica o balanço neste canal (presidência)')
      .addStringOption(o => o.setName('periodo').setDescription('Padrão: últimos 30 dias').addChoices(...PERIODO_CHOICES))
      .addStringOption(o => o.setName('nivel').setDescription('Padrão: só totais')
        .addChoices({ name: 'Só totais', value: 'TOTAIS' }, { name: 'Por categoria', value: 'CATEGORIAS' })))
    .addSubcommand(s => s.setName('excluir').setDescription('Exclui um lançamento manual')
      .addIntegerOption(o => o.setName('id').setDescription('Número do lançamento').setRequired(true))
      .addStringOption(o => o.setName('motivo').setDescription('Por que excluir').setRequired(true).setMaxLength(300))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'lancar') return lancar(interaction);
    if (sub === 'extrato') return extrato(interaction);
    if (sub === 'balanco') return balanco(interaction);
    if (sub === 'publicar-balanco') return publicarBalanco(interaction);
    return excluir(interaction);
  },

  async autocomplete(interaction) {
    const busca = String(interaction.options.getFocused() ?? '').toLowerCase();
    const eventos = await eventosRepo.listarProximos(25);
    return interaction.respond(eventos
      .filter(e => e.titulo.toLowerCase().includes(busca) || String(e.id).startsWith(busca))
      .map(e => ({ name: `#${e.id} ${e.titulo}`.slice(0, 100), value: Number(e.id) })));
  },
};
