const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { registrarLogGestao } = require('../utils/logGestao');
const { arquivarAnexo } = require('../utils/arquivoMidia');
const { PERIODO_CHOICES, resolverPeriodo, formatarDinheiro, formatarNumero, truncar } = require('../utils/logsJogo/estatisticas');
const { parseValor } = require('../utils/financeiro/regras');
const repo = require('../utils/loja/repositorio');
const regras = require('../utils/loja/regras');
const { montarEstruturaLoja } = require('../utils/loja/estrutura');
const { podeGerirLoja } = require('../utils/loja/permissoes');
const tema = require('../tema');
require('../utils/loja/interacoes'); // registra os botões da vitrine e dos pedidos

const MSG_SEM_GESTAO = '❌ SÓ A PRESIDÊNCIA OU O GESTOR DE MATERIAIS E LOJA GERE O CATÁLOGO.';

async function guardarImagem(interaction, nome) {
  const anexo = interaction.options.getAttachment('imagem');
  if (!anexo) return { ref: undefined };
  try {
    return { ref: (await arquivarAnexo(interaction.client, anexo, `🛒 Imagem do produto: ${nome}`)).ref };
  } catch (err) {
    return { erro: `❌ ${String(err.message).toUpperCase()}` };
  }
}

async function adicionar(interaction) {
  if (!(await podeGerirLoja(interaction.member))) return interaction.reply({ content: MSG_SEM_GESTAO, flags: 64 });
  const preco = parseValor(interaction.options.getString('preco'));
  const estoque = regras.parseEstoque(interaction.options.getString('estoque'));
  if (!preco) return interaction.reply({ content: '❌ PREÇO INVÁLIDO.', flags: 64 });
  if (!estoque) return interaction.reply({ content: '❌ ESTOQUE INVÁLIDO. USE `P:10, M:5, G:3` OU SÓ O NÚMERO (EX.: `20`) PARA PRODUTO SEM TAMANHO.', flags: 64 });

  await interaction.deferReply({ flags: 64 });
  const nome = interaction.options.getString('nome');
  const imagem = await guardarImagem(interaction, nome);
  if (imagem.erro) return interaction.editReply({ content: imagem.erro });

  const produto = await repo.criarProduto({
    nome, descricao: interaction.options.getString('descricao'), preco, estoque, imagemRef: imagem.ref ?? null, criadoPorId: interaction.user.id,
  });
  await registrarLogGestao(interaction.client, {
    titulo: `🛒 PRODUTO #${produto.id} CADASTRADO`,
    ator: interaction.user.id,
    campos: [
      { name: 'PRODUTO', value: produto.nome, inline: true },
      { name: 'PREÇO', value: formatarDinheiro(produto.preco), inline: true },
      { name: 'ESTOQUE', value: regras.formatarEstoque(produto.estoque), inline: true },
    ],
  });
  return interaction.editReply({ content: `🦅 PRODUTO #${produto.id} **${produto.nome}** CADASTRADO · ${formatarDinheiro(produto.preco)} · ${regras.formatarEstoque(produto.estoque)}.` });
}

async function editar(interaction) {
  if (!(await podeGerirLoja(interaction.member))) return interaction.reply({ content: MSG_SEM_GESTAO, flags: 64 });
  const produto = await repo.buscarProduto(interaction.options.getInteger('produto'));
  if (!produto) return interaction.reply({ content: '❌ PRODUTO NÃO ENCONTRADO.', flags: 64 });

  const precoTexto = interaction.options.getString('preco');
  const estoqueTexto = interaction.options.getString('estoque');
  const preco = precoTexto ? parseValor(precoTexto) : undefined;
  const estoque = estoqueTexto ? regras.parseEstoque(estoqueTexto) : undefined;
  if (precoTexto && !preco) return interaction.reply({ content: '❌ PREÇO INVÁLIDO.', flags: 64 });
  if (estoqueTexto && !estoque) return interaction.reply({ content: '❌ ESTOQUE INVÁLIDO. USE `P:10, M:5` OU SÓ O NÚMERO.', flags: 64 });

  await interaction.deferReply({ flags: 64 });
  const imagem = await guardarImagem(interaction, produto.nome);
  if (imagem.erro) return interaction.editReply({ content: imagem.erro });

  const atualizado = await repo.editarProduto(produto.id, {
    nome: interaction.options.getString('nome') ?? undefined,
    descricao: interaction.options.getString('descricao') ?? undefined,
    preco,
    estoque,
    ativo: interaction.options.getBoolean('ativo') ?? undefined,
    imagemRef: imagem.ref,
  });
  await registrarLogGestao(interaction.client, {
    titulo: `🛒 PRODUTO #${atualizado.id} EDITADO`,
    ator: interaction.user.id,
    campos: [
      { name: 'PRODUTO', value: atualizado.nome, inline: true },
      { name: 'PREÇO', value: `${formatarDinheiro(produto.preco)} → ${formatarDinheiro(atualizado.preco)}`, inline: true },
      { name: 'ESTOQUE', value: `${regras.formatarEstoque(produto.estoque)} → ${regras.formatarEstoque(atualizado.estoque)}`, inline: false },
      { name: 'À VENDA', value: atualizado.ativo ? 'SIM' : 'NÃO', inline: true },
    ],
  });
  return interaction.editReply({ content: `🦅 PRODUTO #${atualizado.id} ATUALIZADO · ${formatarDinheiro(atualizado.preco)} · ${regras.formatarEstoque(atualizado.estoque)} · ${atualizado.ativo ? 'À VENDA' : 'FORA DE VENDA'}.` });
}

async function listar(interaction) {
  if (!(await podeGerirLoja(interaction.member))) return interaction.reply({ content: MSG_SEM_GESTAO, flags: 64 });
  await interaction.deferReply({ flags: 64 });
  const produtos = await repo.listarProdutos({ apenasAtivos: false });
  const linhas = produtos.map(p => `${p.ativo ? tema.emoji.ativo : tema.emoji.perigo} \`#${p.id}\` **${p.nome}** · ${formatarDinheiro(p.preco)} · ${regras.formatarEstoque(p.estoque)}`);
  return interaction.editReply({
    embeds: [{ color: tema.cor.primaria, title: '📦 CATÁLOGO DA LOJA', description: truncar(linhas.join('\n') || '*Nenhum produto cadastrado.*', 4096) }],
  });
}

async function vendas(interaction) {
  if (!(await podeGerirLoja(interaction.member))) return interaction.reply({ content: MSG_SEM_GESTAO, flags: 64 });
  await interaction.deferReply({ flags: 64 });
  const periodo = resolverPeriodo(interaction.options.getString('periodo') ?? '30d');
  const linhas = await repo.vendasDoPeriodo(periodo.inicio, periodo.fim);
  const total = linhas.reduce((s, l) => s + l.total, 0);
  const pedidos = linhas.reduce((s, l) => s + l.pedidos, 0);
  return interaction.editReply({
    embeds: [{
      color: tema.cor.primaria,
      title: `🛒 VENDAS — ${periodo.rotulo}`,
      description: truncar(linhas.map((l, i) => `${i + 1}. **${l.produto_nome}** · ${formatarNumero(l.unidades)} un. · ${formatarDinheiro(l.total)}`).join('\n') || '*Nenhuma venda confirmada no período.*', 4096),
      fields: [
        { name: 'PEDIDOS CONFIRMADOS', value: formatarNumero(pedidos), inline: true },
        { name: 'FATURAMENTO', value: formatarDinheiro(total), inline: true },
        { name: 'TICKET MÉDIO', value: pedidos ? formatarDinheiro(total / pedidos) : '—', inline: true },
      ],
    }],
  });
}

async function setup(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ APENAS ADMINISTRADORES MONTAM A ESTRUTURA DA LOJA.', flags: 64 });
  }
  await interaction.deferReply({ flags: 64 });
  const resumo = await montarEstruturaLoja(interaction.guild);
  return interaction.editReply({ content: `🛒 **ESTRUTURA DA LOJA VERIFICADA**\n${resumo.join('\n')}` });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loja')
    .setDescription('Loja da torcida (dinheiro do jogo)')
    .addSubcommand(s => s.setName('produto-adicionar').setDescription('Cadastra um produto')
      .addStringOption(o => o.setName('nome').setDescription('Nome').setRequired(true).setMaxLength(80))
      .addStringOption(o => o.setName('preco').setDescription('Preço (ex.: 1500)').setRequired(true))
      .addStringOption(o => o.setName('estoque').setDescription('P:10, M:5, G:3 — ou só o número se não tiver tamanho').setRequired(true))
      .addAttachmentOption(o => o.setName('imagem').setDescription('Foto do produto'))
      .addStringOption(o => o.setName('descricao').setDescription('Descrição').setMaxLength(500)))
    .addSubcommand(s => s.setName('produto-editar').setDescription('Altera preço, estoque, foto ou disponibilidade')
      .addIntegerOption(o => o.setName('produto').setDescription('Produto').setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName('preco').setDescription('Novo preço'))
      .addStringOption(o => o.setName('estoque').setDescription('Estoque completo: P:10, M:5 — substitui o atual'))
      .addBooleanOption(o => o.setName('ativo').setDescription('À venda?'))
      .addStringOption(o => o.setName('nome').setDescription('Novo nome').setMaxLength(80))
      .addAttachmentOption(o => o.setName('imagem').setDescription('Nova foto'))
      .addStringOption(o => o.setName('descricao').setDescription('Nova descrição').setMaxLength(500)))
    .addSubcommand(s => s.setName('produtos').setDescription('Catálogo completo com estoque'))
    .addSubcommand(s => s.setName('vendas').setDescription('Vendas confirmadas no período')
      .addStringOption(o => o.setName('periodo').setDescription('Padrão: últimos 30 dias').addChoices(...PERIODO_CHOICES)))
    .addSubcommand(s => s.setName('setup').setDescription('Cria a vitrine, a categoria de pedidos e o arquivo de imagens (administrador)')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'produto-adicionar') return adicionar(interaction);
    if (sub === 'produto-editar') return editar(interaction);
    if (sub === 'produtos') return listar(interaction);
    if (sub === 'vendas') return vendas(interaction);
    return setup(interaction);
  },

  async autocomplete(interaction) {
    const busca = String(interaction.options.getFocused() ?? '').toLowerCase();
    const produtos = await repo.listarProdutos({ apenasAtivos: false });
    return interaction.respond(produtos
      .filter(p => p.nome.toLowerCase().includes(busca) || String(p.id).startsWith(busca))
      .slice(0, 25)
      .map(p => ({ name: `#${p.id} ${p.nome}${p.ativo ? '' : ' (fora de venda)'}`.slice(0, 100), value: Number(p.id) })));
  },
};
