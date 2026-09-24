const { SlashCommandBuilder } = require('discord.js');
const { registrarLogGestao } = require('../utils/logGestao');
const { arquivarAnexo, urlDaMidia } = require('../utils/arquivoMidia');
const { truncar } = require('../utils/logsJogo/estatisticas');
const eventosRepo = require('../utils/eventos/repositorio');
const repo = require('../utils/patrimonio/repositorio');
const regras = require('../utils/patrimonio/regras');
const { escopoPatrimonioDe } = require('../utils/patrimonio/permissoes');
const tema = require('../tema');

const unix = d => Math.floor(new Date(d).getTime() / 1000);
const MSG_FORA_DO_ESCOPO = '❌ ESTE ITEM ESTÁ FORA DO SEU ACERVO (PATRIMÔNIO, BANDEIRAS OU BATERIA).';

// Evidência em foto é obrigatória na saída e na volta; a imagem vai para o arquivo do bot
async function guardarFoto(interaction, nomeOpcao, legenda, obrigatoria) {
  const anexo = interaction.options.getAttachment(nomeOpcao);
  if (!anexo) return obrigatoria ? { erro: '❌ A FOTO É OBRIGATÓRIA.' } : { ref: undefined };
  try {
    return await arquivarAnexo(interaction.client, anexo, legenda);
  } catch (err) {
    return { erro: `❌ ${String(err.message).toUpperCase()}` };
  }
}

async function carregarItem(interaction, nivel) {
  const [item, escopo] = await Promise.all([repo.buscarItem(interaction.options.getInteger('item')), escopoPatrimonioDe(interaction.member)]);
  if (!item) return { erro: '❌ ITEM NÃO ENCONTRADO.' };
  // Item de outro recorte é tratado como inexistente para quem só vê o próprio
  if (!regras.permite(escopo.ver, item.categoria)) return { erro: '❌ ITEM NÃO ENCONTRADO.' };
  if (!regras.permite(escopo[nivel], item.categoria)) return { erro: MSG_FORA_DO_ESCOPO };
  return { item, escopo };
}

async function adicionar(interaction) {
  const escopo = await escopoPatrimonioDe(interaction.member);
  const categoria = interaction.options.getString('categoria');
  if (!regras.permite(escopo.gerir, categoria)) return interaction.reply({ content: MSG_FORA_DO_ESCOPO, flags: 64 });
  const subtipo = interaction.options.getString('tipo');
  const validacao = regras.validarSubtipo(categoria, subtipo);
  if (!validacao.ok) return interaction.reply({ content: validacao.mensagem, flags: 64 });

  await interaction.deferReply({ flags: 64 });
  const nome = interaction.options.getString('nome');
  const foto = await guardarFoto(interaction, 'foto', `🗃️ Acervo: ${nome}`, false);
  if (foto.erro) return interaction.editReply({ content: foto.erro });

  const item = await repo.criarItem({
    nome,
    categoria,
    subtipo: subtipo ?? null,
    quantidade: interaction.options.getInteger('quantidade') ?? 1,
    localizacao: interaction.options.getString('local'),
    responsavelId: interaction.options.getUser('responsavel')?.id ?? null,
    fotoRef: foto.ref ?? null,
    observacao: interaction.options.getString('observacao'),
    criadoPorId: interaction.user.id,
  });
  await registrarLogGestao(interaction.client, {
    titulo: '🗃️ ITEM CADASTRADO NO ACERVO',
    ator: interaction.user.id,
    campos: [{ name: 'ITEM', value: regras.rotuloItem(item), inline: true }, { name: 'LOCAL', value: item.localizacao || '—', inline: true }],
  });
  return interaction.editReply({ content: `🦅 ${regras.rotuloItem(item)} CADASTRADO.` });
}

async function lista(interaction) {
  const escopo = await escopoPatrimonioDe(interaction.member);
  const permitidas = regras.categoriasPermitidas(escopo.ver);
  if (Array.isArray(permitidas) && !permitidas.length) {
    return interaction.reply({ content: '❌ O ACERVO É VISTO PELA LIDERANÇA E PELAS ÁREAS PATRIMÔNIO, BANDEIRAS E BATERIA.', flags: 64 });
  }
  const filtro = interaction.options.getString('categoria');
  // O filtro do usuário nunca amplia o escopo: interseção com o que ele pode ver
  const categorias = filtro ? (regras.permite(escopo.ver, filtro) ? [filtro] : []) : permitidas;
  await interaction.deferReply({ flags: 64 });
  const itens = await repo.listarItens({ categorias, incluirBaixados: interaction.options.getBoolean('incluir_baixados') ?? false });
  const linhas = itens.map(i => `${regras.rotuloItem(i)}${i.status === 'BAIXADO' ? ' · ~~baixado~~' : i.emprestimo_discord_id ? ` · 📤 com <@${i.emprestimo_discord_id}>` : i.localizacao ? ` · 📍 ${i.localizacao}` : ''}`);
  return interaction.editReply({
    embeds: [{ color: tema.cor.primaria, title: '🗃️ ACERVO DA TORCIDA', description: truncar(linhas.join('\n') || '*Nenhum item.*', 4096) }],
    allowedMentions: { parse: [] },
  });
}

async function ver(interaction) {
  const { item, erro } = await carregarItem(interaction, 'ver');
  if (erro) return interaction.reply({ content: erro, flags: 64 });
  await interaction.deferReply({ flags: 64 });
  const [foto, evento] = await Promise.all([
    urlDaMidia(interaction.client, item.foto_ref),
    item.emprestimo_evento_id ? eventosRepo.buscarEvento(item.emprestimo_evento_id) : null,
  ]);
  const situacao = item.status === 'BAIXADO'
    ? `🔴 Baixado <t:${unix(item.baixado_em)}:d> — ${item.baixado_motivo}`
    : item.emprestimo_id
      ? `📤 Com <@${item.emprestimo_discord_id}> desde <t:${unix(item.emprestimo_saiu_em)}:f>${evento ? ` · para **${evento.titulo}**` : ' · saída avulsa'}`
      : `${tema.emoji.ativo} Guardado`;
  return interaction.editReply({
    embeds: [{
      color: tema.cor.primaria,
      title: regras.rotuloItem(item),
      fields: [
        { name: 'SITUAÇÃO', value: situacao, inline: false },
        { name: 'ONDE FICA GUARDADO', value: item.localizacao || '—', inline: true },
        { name: 'RESPONSÁVEL', value: item.responsavel_id ? `<@${item.responsavel_id}>` : '—', inline: true },
        ...(item.observacao ? [{ name: 'OBSERVAÇÃO', value: truncar(item.observacao, 1000), inline: false }] : []),
      ],
      ...(foto ? { image: { url: foto } } : {}),
    }],
    allowedMentions: { parse: [] },
  });
}

async function retirar(interaction) {
  const { item, erro } = await carregarItem(interaction, 'movimentar');
  if (erro) return interaction.reply({ content: erro, flags: 64 });
  const eventoId = interaction.options.getInteger('evento');
  if (eventoId && !(await eventosRepo.buscarEvento(eventoId))) return interaction.reply({ content: '❌ EVENTO NÃO ENCONTRADO.', flags: 64 });

  await interaction.deferReply({ flags: 64 });
  const quem = interaction.options.getUser('com') ?? interaction.user;
  const foto = await guardarFoto(interaction, 'foto', `📤 Saída: ${regras.rotuloItem(item)} — com ${quem.tag}`, true);
  if (foto.erro) return interaction.editReply({ content: foto.erro });

  const r = await repo.abrirEmprestimo({
    itemId: item.id, discordId: quem.id, eventoId, fotoSaidaRef: foto.ref, observacao: interaction.options.getString('observacao'), porId: interaction.user.id,
  });
  if (r.erro) return interaction.editReply({ content: r.erro, allowedMentions: { parse: [] } });
  await registrarLogGestao(interaction.client, {
    titulo: '📤 SAÍDA DO ACERVO',
    ator: interaction.user.id,
    campos: [
      { name: 'ITEM', value: regras.rotuloItem(item), inline: true },
      { name: 'COM', value: `<@${quem.id}>`, inline: true },
      { name: 'FOTO DE SAÍDA', value: `[ver](${foto.link})`, inline: true },
    ],
  });
  return interaction.editReply({ content: `📤 ${regras.rotuloItem(item)} SAIU COM ${quem}. REGISTRE A VOLTA COM \`/patrimonio devolver\` E FOTO.`, allowedMentions: { parse: [] } });
}

async function devolver(interaction) {
  const { item, erro } = await carregarItem(interaction, 'movimentar');
  if (erro) return interaction.reply({ content: erro, flags: 64 });
  if (!item.emprestimo_id) return interaction.reply({ content: '⚠️ ESTE ITEM NÃO ESTÁ FORA.', flags: 64 });

  await interaction.deferReply({ flags: 64 });
  const foto = await guardarFoto(interaction, 'foto', `📥 Volta: ${regras.rotuloItem(item)}`, true);
  if (foto.erro) return interaction.editReply({ content: foto.erro });
  const comDano = interaction.options.getBoolean('dano') ?? false;
  const emprestimo = await repo.fecharEmprestimo({ itemId: item.id, fotoVoltaRef: foto.ref, comDano, observacao: interaction.options.getString('observacao') });
  if (!emprestimo) return interaction.editReply({ content: '⚠️ A DEVOLUÇÃO JÁ TINHA SIDO REGISTRADA.' });

  await registrarLogGestao(interaction.client, {
    titulo: comDano ? '⚠️ VOLTOU AO ACERVO COM DANO' : '📥 VOLTOU AO ACERVO',
    ator: interaction.user.id,
    cor: comDano ? tema.cor.perigo : tema.cor.primaria,
    campos: [
      { name: 'ITEM', value: regras.rotuloItem(item), inline: true },
      { name: 'ESTAVA COM', value: `<@${emprestimo.discord_id}>`, inline: true },
      { name: 'FOTO DA VOLTA', value: `[ver](${foto.link})`, inline: true },
    ],
  });
  return interaction.editReply({ content: `📥 ${regras.rotuloItem(item)} DEVOLVIDO${comDano ? ' — ⚠️ DANO REGISTRADO' : ''}.` });
}

async function editar(interaction) {
  const { item, escopo, erro } = await carregarItem(interaction, 'gerir');
  if (erro) return interaction.reply({ content: erro, flags: 64 });
  const categoria = interaction.options.getString('categoria') ?? item.categoria;
  if (!regras.podeMudarCategoria(escopo, item.categoria, categoria)) return interaction.reply({ content: MSG_FORA_DO_ESCOPO, flags: 64 });
  const subtipo = categoria === 'BANDEIRA' ? (interaction.options.getString('tipo') ?? item.subtipo) : null;
  const validacao = regras.validarSubtipo(categoria, subtipo);
  if (!validacao.ok) return interaction.reply({ content: validacao.mensagem, flags: 64 });

  await interaction.deferReply({ flags: 64 });
  const foto = await guardarFoto(interaction, 'foto', `🗃️ Acervo: ${item.nome}`, false);
  if (foto.erro) return interaction.editReply({ content: foto.erro });
  const atualizado = await repo.editarItem(item.id, {
    nome: interaction.options.getString('nome') ?? undefined,
    categoria,
    subtipo,
    quantidade: interaction.options.getInteger('quantidade') ?? undefined,
    localizacao: interaction.options.getString('local') ?? undefined,
    responsavelId: interaction.options.getUser('responsavel')?.id ?? undefined,
    fotoRef: foto.ref,
  });
  await registrarLogGestao(interaction.client, {
    titulo: '🗃️ ITEM DO ACERVO EDITADO',
    ator: interaction.user.id,
    campos: [{ name: 'ANTES', value: regras.rotuloItem(item), inline: true }, { name: 'DEPOIS', value: regras.rotuloItem(atualizado), inline: true }],
  });
  return interaction.editReply({ content: `🦅 ${regras.rotuloItem(atualizado)} ATUALIZADO.` });
}

async function baixar(interaction) {
  const { item, erro } = await carregarItem(interaction, 'gerir');
  if (erro) return interaction.reply({ content: erro, flags: 64 });
  if (item.emprestimo_id) return interaction.reply({ content: '❌ O ITEM ESTÁ FORA. REGISTRE A DEVOLUÇÃO ANTES DE DAR BAIXA.', flags: 64 });
  const motivo = interaction.options.getString('motivo');
  const baixado = await repo.baixarItem(item.id, motivo);
  if (!baixado) return interaction.reply({ content: '⚠️ ESTE ITEM JÁ ESTAVA BAIXADO.', flags: 64 });
  // Baixa preserva o histórico: o item continua no banco, só sai do acervo ativo
  await registrarLogGestao(interaction.client, {
    titulo: '🔴 BAIXA NO ACERVO',
    ator: interaction.user.id,
    cor: tema.cor.perigo,
    campos: [{ name: 'ITEM', value: regras.rotuloItem(item), inline: true }, { name: 'MOTIVO', value: motivo, inline: true }],
  });
  return interaction.reply({ content: `🔴 BAIXA REGISTRADA: ${regras.rotuloItem(item)}.`, flags: 64 });
}

async function pendencias(interaction) {
  const escopo = await escopoPatrimonioDe(interaction.member);
  const categorias = regras.categoriasPermitidas(escopo.ver);
  if (Array.isArray(categorias) && !categorias.length) return interaction.reply({ content: MSG_FORA_DO_ESCOPO, flags: 64 });
  await interaction.deferReply({ flags: 64 });
  const abertos = await repo.emprestimosAbertos(categorias);
  const agora = new Date();
  const comPendencia = abertos.map(e => ({ e, motivo: regras.pendenciaDoEmprestimo(e, agora) })).filter(x => x.motivo);
  const linhas = comPendencia.map(({ e, motivo }) =>
    `🔴 ${regras.rotuloItem({ id: e.item_id, nome: e.item_nome, categoria: e.categoria, subtipo: e.subtipo, quantidade: e.quantidade })} · com <@${e.discord_id}> · **${motivo}**${e.evento_titulo ? ` (${e.evento_titulo})` : ''}`);
  return interaction.editReply({
    embeds: [{
      color: comPendencia.length ? tema.cor.perigo : tema.cor.primaria,
      title: '🗃️ O QUE NÃO VOLTOU',
      description: truncar(linhas.join('\n') || '*Nada pendente: tudo o que saiu está dentro do prazo.*', 4096),
      footer: { text: `${abertos.length} item(ns) fora no total · alerta: evento já passou ou mais de 7 dias fora` },
    }],
    allowedMentions: { parse: [] },
  });
}

const opcaoItem = o => o.setName('item').setDescription('Item do acervo').setRequired(true).setAutocomplete(true);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('patrimonio')
    .setDescription('Acervo da torcida: bandeiras, instrumentos e materiais')
    .addSubcommand(s => s.setName('adicionar').setDescription('Cadastra um item no acervo')
      .addStringOption(o => o.setName('nome').setDescription('Nome').setRequired(true).setMaxLength(80))
      .addStringOption(o => o.setName('categoria').setDescription('Categoria').setRequired(true).addChoices(...regras.CATEGORIA_PATRIMONIO_CHOICES))
      .addStringOption(o => o.setName('tipo').setDescription('Só para bandeiras: bandeira, faixa ou mastro').addChoices(...regras.SUBTIPO_CHOICES))
      .addIntegerOption(o => o.setName('quantidade').setDescription('Padrão: 1').setMinValue(1).setMaxValue(1000))
      .addStringOption(o => o.setName('local').setDescription('Onde fica guardado').setMaxLength(100))
      .addUserOption(o => o.setName('responsavel').setDescription('Quem responde pelo item'))
      .addAttachmentOption(o => o.setName('foto').setDescription('Foto do item'))
      .addStringOption(o => o.setName('observacao').setDescription('Observação').setMaxLength(500)))
    .addSubcommand(s => s.setName('lista').setDescription('Itens do acervo que você pode ver')
      .addStringOption(o => o.setName('categoria').setDescription('Filtrar').addChoices(...regras.CATEGORIA_PATRIMONIO_CHOICES))
      .addBooleanOption(o => o.setName('incluir_baixados').setDescription('Mostrar itens baixados')))
    .addSubcommand(s => s.setName('ver').setDescription('Ficha do item: onde está e com quem').addIntegerOption(opcaoItem))
    .addSubcommand(s => s.setName('retirar').setDescription('Registra a saída de um item (foto obrigatória)')
      .addIntegerOption(opcaoItem)
      .addAttachmentOption(o => o.setName('foto').setDescription('Foto de saída').setRequired(true))
      .addUserOption(o => o.setName('com').setDescription('Quem leva (padrão: você)'))
      .addIntegerOption(o => o.setName('evento').setDescription('Para qual evento saiu').setAutocomplete(true))
      .addStringOption(o => o.setName('observacao').setDescription('Observação').setMaxLength(300)))
    .addSubcommand(s => s.setName('devolver').setDescription('Registra a volta de um item (foto obrigatória)')
      .addIntegerOption(opcaoItem)
      .addAttachmentOption(o => o.setName('foto').setDescription('Foto da volta').setRequired(true))
      .addBooleanOption(o => o.setName('dano').setDescription('Voltou com dano?'))
      .addStringOption(o => o.setName('observacao').setDescription('Observação').setMaxLength(300)))
    .addSubcommand(s => s.setName('editar').setDescription('Altera dados do item')
      .addIntegerOption(opcaoItem)
      .addStringOption(o => o.setName('nome').setDescription('Nome').setMaxLength(80))
      .addStringOption(o => o.setName('categoria').setDescription('Categoria').addChoices(...regras.CATEGORIA_PATRIMONIO_CHOICES))
      .addStringOption(o => o.setName('tipo').setDescription('Só para bandeiras').addChoices(...regras.SUBTIPO_CHOICES))
      .addIntegerOption(o => o.setName('quantidade').setDescription('Quantidade').setMinValue(1).setMaxValue(1000))
      .addStringOption(o => o.setName('local').setDescription('Onde fica guardado').setMaxLength(100))
      .addUserOption(o => o.setName('responsavel').setDescription('Responsável'))
      .addAttachmentOption(o => o.setName('foto').setDescription('Nova foto')))
    .addSubcommand(s => s.setName('baixar').setDescription('Dá baixa num item (preserva o histórico)')
      .addIntegerOption(opcaoItem)
      .addStringOption(o => o.setName('motivo').setDescription('Motivo da baixa').setRequired(true).setMaxLength(300)))
    .addSubcommand(s => s.setName('pendencias').setDescription('O que saiu e não voltou')),

  async execute(interaction) {
    const acoes = { adicionar, lista, ver, retirar, devolver, editar, baixar, pendencias };
    return acoes[interaction.options.getSubcommand()](interaction);
  },

  async autocomplete(interaction) {
    const focado = interaction.options.getFocused(true);
    const busca = String(focado.value ?? '').toLowerCase();
    if (focado.name === 'evento') {
      const eventos = await eventosRepo.listarProximos(25);
      return interaction.respond(eventos.filter(e => e.titulo.toLowerCase().includes(busca))
        .map(e => ({ name: `#${e.id} ${e.titulo}`.slice(0, 100), value: Number(e.id) })));
    }
    const escopo = await escopoPatrimonioDe(interaction.member);
    const itens = await repo.listarItens({ categorias: regras.categoriasPermitidas(escopo.ver) });
    return interaction.respond(itens
      .filter(i => i.nome.toLowerCase().includes(busca) || String(i.id).startsWith(busca))
      .slice(0, 25)
      .map(i => ({ name: regras.rotuloItem(i).slice(0, 100), value: Number(i.id) })));
  },
};
