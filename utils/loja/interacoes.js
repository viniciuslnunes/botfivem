const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ModalBuilder, PermissionFlagsBits: P,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const config = require('../../config/index.js');
const { registrarModulo } = require('../modulos');
const { registrarLogGestao, CHAVE_CANAL_LOGS_GESTAO } = require('../logGestao');
const { lerConfig } = require('../botConfig');
const { urlDaMidia } = require('../arquivoMidia');
const { gerarTranscript } = require('../ticket');
const { formatarDinheiro } = require('../logsJogo/estatisticas');
const { chaveDia } = require('../logsJogo/estatisticas');
const { cargosQueAtendem } = require('../departamentos/acesso');
const financeiro = require('../financeiro/repositorio');
const repo = require('./repositorio');
const regras = require('./regras');
const { categoriaDaLoja } = require('./estrutura');
const { podeAtenderPedido } = require('./permissoes');

// loja:ver · loja:produto · loja:tamanho:<id> · loja:comprar:<id>:<tam> · loja:pedido:<id>:<tam>
// loja:confirmar:<pedido> · loja:cancelar:<pedido>

const soSocio = interaction => interaction.member?.roles.cache.has(config.cargos.socio);
const MSG_SO_SOCIO = '❌ A LOJA É EXCLUSIVA PARA SÓCIOS.';

async function verProdutos(interaction) {
  if (!soSocio(interaction)) return interaction.reply({ content: MSG_SO_SOCIO, flags: 64 });
  const produtos = (await repo.listarProdutos()).filter(p => regras.tamanhosDisponiveis(p.estoque).length);
  if (!produtos.length) return interaction.reply({ content: '🛒 NENHUM PRODUTO DISPONÍVEL NO MOMENTO.', flags: 64 });
  const select = new StringSelectMenuBuilder()
    .setCustomId('loja:produto')
    .setPlaceholder('SELECIONE O PRODUTO')
    .addOptions(produtos.slice(0, 25).map(p => ({ label: p.nome.slice(0, 100), description: formatarDinheiro(p.preco), value: String(p.id) })));
  return interaction.reply({ content: '**🛒 PRODUTOS DISPONÍVEIS**', components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
}

async function mostrarProduto(interaction, produtoId) {
  const produto = await repo.buscarProduto(produtoId);
  const disponiveis = produto?.ativo ? regras.tamanhosDisponiveis(produto.estoque) : [];
  if (!disponiveis.length) return interaction.update({ content: '❌ ESTE PRODUTO ESGOTOU OU SAIU DE VENDA.', components: [], embeds: [] });

  const imagem = await urlDaMidia(interaction.client, produto.imagem_ref);
  const embed = {
    color: 0x000000,
    title: produto.nome.toUpperCase(),
    description: produto.descricao || null,
    fields: [
      { name: 'PREÇO', value: formatarDinheiro(produto.preco), inline: true },
      { name: 'ESTOQUE', value: regras.formatarEstoque(produto.estoque), inline: true },
    ],
    ...(imagem ? { image: { url: imagem } } : {}),
  };
  const componente = disponiveis.length === 1 && disponiveis[0] === regras.TAMANHO_UNICO
    ? new ActionRowBuilder().addComponents(new ButtonBuilder()
      .setCustomId(`loja:comprar:${produto.id}:${regras.TAMANHO_UNICO}`).setLabel('COMPRAR').setEmoji('🛒').setStyle(ButtonStyle.Primary))
    : new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`loja:tamanho:${produto.id}`)
      .setPlaceholder('SELECIONE O TAMANHO')
      .addOptions(disponiveis.map(t => ({ label: `${regras.rotuloTamanho(t)} (${produto.estoque[t]} un.)`, value: t }))));
  return interaction.update({ content: null, embeds: [embed], components: [componente] });
}

function modalPedido(produtoId, tamanho) {
  return new ModalBuilder()
    .setCustomId(`loja:pedido:${produtoId}:${tamanho}`)
    .setTitle('FINALIZAR PEDIDO')
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder()
        .setCustomId('quantidade').setLabel(`QUANTIDADE (1 a ${regras.MAX_UNIDADES_POR_PEDIDO})`)
        .setStyle(TextInputStyle.Short).setRequired(true).setValue('1').setMaxLength(2)),
      new ActionRowBuilder().addComponents(new TextInputBuilder()
        .setCustomId('observacao').setLabel('OBSERVAÇÕES (OPCIONAL)')
        .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(300))
    );
}

function montarMensagemPedido(pedido) {
  return {
    content: `<@${pedido.discord_id}>`,
    embeds: [
      {
        color: 0xFFFFFF,
        title: `🛒 PEDIDO #${pedido.id}`,
        fields: [
          { name: 'PRODUTO', value: pedido.produto_nome.toUpperCase(), inline: true },
          { name: 'TAMANHO', value: regras.rotuloTamanho(pedido.tamanho), inline: true },
          { name: 'QUANTIDADE', value: String(pedido.quantidade), inline: true },
          { name: 'PREÇO UNIT.', value: formatarDinheiro(pedido.preco_unit), inline: true },
          { name: 'TOTAL', value: formatarDinheiro(pedido.total), inline: true },
          ...(pedido.observacao ? [{ name: 'OBSERVAÇÕES', value: pedido.observacao, inline: false }] : []),
          { name: 'COMPRADOR', value: `<@${pedido.discord_id}>`, inline: false },
        ],
      },
      {
        color: 0x000000,
        title: '💵 PAGAMENTO NO JOGO',
        description: `Pague **${formatarDinheiro(pedido.total)}** ao responsável da loja **dentro do jogo** e envie o print aqui.\nA equipe confirma o pedido depois de receber. O item fica reservado para você até lá.`,
      },
    ],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`loja:confirmar:${pedido.id}`).setLabel('CONFIRMAR PAGAMENTO').setEmoji('🤝').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`loja:cancelar:${pedido.id}`).setLabel('CANCELAR PEDIDO').setStyle(ButtonStyle.Danger)
    )],
    allowedMentions: { users: [pedido.discord_id] },
  };
}

async function registrarPedido(interaction, produtoId, tamanho) {
  if (!soSocio(interaction)) return interaction.reply({ content: MSG_SO_SOCIO, flags: 64 });
  const quantidade = Number(interaction.fields.getTextInputValue('quantidade').trim());
  const observacao = interaction.fields.getTextInputValue('observacao')?.trim() || null;
  await interaction.deferReply({ flags: 64 });

  if (await repo.contarPedidosAbertos(interaction.user.id) >= regras.MAX_PEDIDOS_ABERTOS) {
    return interaction.editReply({ content: `❌ VOCÊ JÁ TEM ${regras.MAX_PEDIDOS_ABERTOS} PEDIDOS EM ABERTO. AGUARDE A EQUIPE CONFIRMAR OU CANCELE UM DELES.` });
  }
  const r = await repo.criarPedido({ produtoId, tamanho, quantidade, discordId: interaction.user.id, observacao });
  if (r.erro) return interaction.editReply({ content: r.erro });

  let canal;
  try {
    const categoriaId = await categoriaDaLoja();
    const equipe = await cargosQueAtendem('loja');
    canal = await interaction.guild.channels.create({
      name: `pedido-${r.pedido.id}`,
      type: ChannelType.GuildText,
      parent: categoriaId && interaction.guild.channels.cache.has(categoriaId) ? categoriaId : undefined,
      topic: `Pedido #${r.pedido.id} de ${interaction.user.tag} — ${r.pedido.produto_nome}`,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, deny: [P.ViewChannel] },
        { id: interaction.user.id, allow: [P.ViewChannel, P.SendMessages, P.AttachFiles, P.ReadMessageHistory] },
        ...equipe.map(id => ({ id, allow: [P.ViewChannel, P.SendMessages, P.AttachFiles, P.ReadMessageHistory] })),
        { id: interaction.guild.members.me.id, allow: [P.ViewChannel, P.SendMessages, P.ManageChannels, P.ReadMessageHistory] },
      ],
    });
    await repo.gravarCanalPedido(r.pedido.id, canal.id);
    await canal.send(montarMensagemPedido(r.pedido));
  } catch (err) {
    // Sem canal não há atendimento: o pedido é desfeito e a peça volta ao estoque
    console.error('[loja] Erro ao abrir canal do pedido:', err);
    await repo.decidirPedido(r.pedido.id, 'CANCELADO', interaction.client.user.id).catch(() => {});
    return interaction.editReply({ content: '❌ NÃO FOI POSSÍVEL ABRIR O ATENDIMENTO DO PEDIDO. NADA FOI RESERVADO — TENTE NOVAMENTE.' });
  }
  return interaction.editReply({ content: `🛒 PEDIDO #${r.pedido.id} ABERTO: ${canal}. O item está reservado para você.` });
}

async function encerrarCanalDoPedido(interaction, pedido, titulo) {
  const canal = interaction.channel;
  try {
    const logsId = await lerConfig(CHAVE_CANAL_LOGS_GESTAO);
    const logs = logsId ? await interaction.client.channels.fetch(logsId).catch(() => null) : null;
    if (logs && canal) {
      const html = await gerarTranscript(canal);
      await logs.send({ content: titulo, files: [{ attachment: Buffer.from(html, 'utf-8'), name: `pedido-${pedido.id}.html` }], allowedMentions: { parse: [] } });
    }
  } catch (err) {
    console.error('[loja] Erro ao arquivar transcript do pedido:', err);
  }
  setTimeout(() => canal?.delete().catch(() => {}), 5000);
}

async function decidir(interaction, pedidoId, status) {
  const pedido = await repo.buscarPedido(pedidoId);
  if (!pedido) return interaction.reply({ content: '❌ PEDIDO NÃO ENCONTRADO.', flags: 64 });
  const atende = await podeAtenderPedido(interaction.member);
  const ehComprador = pedido.discord_id === interaction.user.id;
  if (status === 'CONFIRMADO' && !atende) {
    return interaction.reply({ content: '❌ SÓ A EQUIPE DA LOJA CONFIRMA O PAGAMENTO.', flags: 64 });
  }
  if (status === 'CANCELADO' && !atende && !ehComprador) {
    return interaction.reply({ content: '❌ SÓ O COMPRADOR OU A EQUIPE DA LOJA CANCELA O PEDIDO.', flags: 64 });
  }

  await interaction.deferReply();
  const r = await repo.decidirPedido(pedidoId, status, interaction.user.id);
  if (r.erro) return interaction.editReply({ content: r.erro });

  if (status === 'CONFIRMADO') {
    // Receita no livro-caixa, uma vez só por pedido (origem LOJA + id do pedido)
    await financeiro.lancar({
      tipo: 'RECEITA',
      categoria: 'LOJA',
      valor: Number(r.pedido.total),
      descricao: `Pedido #${r.pedido.id} — ${r.pedido.quantidade}× ${r.pedido.produto_nome} (${regras.rotuloTamanho(r.pedido.tamanho)})`,
      data: chaveDia(new Date()),
      areaSlug: 'loja',
      origem: 'LOJA',
      origemId: String(r.pedido.id),
      criadoPorId: interaction.user.id,
    }).catch(err => console.error('[loja] Erro ao lançar receita do pedido:', err));
  }

  const confirmado = status === 'CONFIRMADO';
  await registrarLogGestao(interaction.client, {
    titulo: `🛒 PEDIDO #${r.pedido.id} ${confirmado ? 'CONFIRMADO' : 'CANCELADO'}`,
    ator: interaction.user.id,
    cor: confirmado ? 0x2ECC71 : 0xFF0000,
    campos: [
      { name: 'COMPRADOR', value: `<@${r.pedido.discord_id}>`, inline: true },
      { name: 'ITEM', value: `${r.pedido.quantidade}× ${r.pedido.produto_nome} (${regras.rotuloTamanho(r.pedido.tamanho)})`, inline: true },
      { name: 'TOTAL', value: formatarDinheiro(r.pedido.total), inline: true },
    ],
  });
  await interaction.editReply({
    content: confirmado
      ? `🤝 PAGAMENTO CONFIRMADO. PEDIDO #${r.pedido.id} CONCLUÍDO — ESTE CANAL SERÁ FECHADO.`
      : `❌ PEDIDO #${r.pedido.id} CANCELADO. O ITEM VOLTOU AO ESTOQUE — ESTE CANAL SERÁ FECHADO.`,
  });
  return encerrarCanalDoPedido(interaction, r.pedido, `${confirmado ? '🤝' : '❌'} PEDIDO #${r.pedido.id} ${confirmado ? 'CONFIRMADO' : 'CANCELADO'} — transcript`);
}

registrarModulo('loja', async interaction => {
  const [, acao, a, b] = interaction.customId.split(':');
  if (interaction.isButton() && acao === 'ver') return verProdutos(interaction);
  if (interaction.isStringSelectMenu() && acao === 'produto') return mostrarProduto(interaction, interaction.values[0]);
  if (interaction.isStringSelectMenu() && acao === 'tamanho') return interaction.showModal(modalPedido(a, interaction.values[0]));
  if (interaction.isButton() && acao === 'comprar') return interaction.showModal(modalPedido(a, b));
  if (interaction.isModalSubmit() && acao === 'pedido') return registrarPedido(interaction, a, b);
  if (interaction.isButton() && acao === 'confirmar') return decidir(interaction, a, 'CONFIRMADO');
  if (interaction.isButton() && acao === 'cancelar') return decidir(interaction, a, 'CANCELADO');
});

module.exports = { montarMensagemPedido, modalPedido };
