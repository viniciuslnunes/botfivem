const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits: P } = require('discord.js');
const config = require('../../config/index.js');
const { lerConfig, gravarConfig } = require('../botConfig');
const { CHAVE_CANAL_ARQUIVO } = require('../arquivoMidia');

// Categoria da loja (pedidos privados), vitrine pública para sócios e arquivo de imagens
const CHAVE_CATEGORIA = 'categoria_loja';
const CHAVE_VITRINE = 'canal_vitrine_loja';
const CHAVE_MENSAGEM_VITRINE = 'mensagem_vitrine_loja';
const LER = [P.ViewChannel, P.ReadMessageHistory];
const ESCREVER = [...LER, P.SendMessages, P.EmbedLinks, P.AttachFiles];

function mensagemVitrine() {
  return {
    embeds: [{
      color: 0x000000,
      title: '🛒 LOJA — GAVIÕES DA FIEL FIVEM',
      description: 'Clique no botão abaixo para ver os produtos disponíveis.\nO pagamento é feito **no jogo**: o pedido abre um canal privado com a equipe da loja.',
    }],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('loja:ver').setLabel('VER PRODUTOS').setEmoji('🛒').setStyle(ButtonStyle.Secondary)
    )],
  };
}

async function garantirCanal(guild, chave, opcoes) {
  const id = await lerConfig(chave);
  const existente = id && guild.channels.cache.get(id);
  if (existente) return { canal: existente, criado: false };
  const canal = await guild.channels.create({ ...opcoes, reason: 'Loja da torcida' });
  await gravarConfig(chave, canal.id);
  return { canal, criado: true };
}

async function montarEstruturaLoja(guild) {
  await guild.channels.fetch();
  const botId = guild.members.me.id;
  const resumo = [];

  const categoria = await garantirCanal(guild, CHAVE_CATEGORIA, {
    name: '🛒 LOJA',
    type: ChannelType.GuildCategory,
    permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [P.ViewChannel] }, { id: botId, allow: [...ESCREVER, P.ManageChannels] }],
  });
  if (categoria.criado) resumo.push('📁 Categoria LOJA criada');

  const vitrine = await garantirCanal(guild, CHAVE_VITRINE, {
    name: '🛒・loja',
    type: ChannelType.GuildText,
    parent: categoria.canal.id,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
      { id: config.cargos.socio, allow: LER, deny: [P.SendMessages] },
      { id: botId, allow: ESCREVER },
    ],
  });
  if (vitrine.criado) resumo.push('🛒 Canal da vitrine criado');

  const arquivo = await garantirCanal(guild, CHAVE_CANAL_ARQUIVO, {
    name: '🗂️・arquivo-midia',
    type: ChannelType.GuildText,
    parent: categoria.canal.id,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
      ...config.lideranca.map(id => ({ id, allow: LER, deny: [P.SendMessages] })),
      { id: botId, allow: ESCREVER },
    ],
  });
  if (arquivo.criado) resumo.push('🗂️ Canal de arquivo de imagens criado');

  const mensagemId = await lerConfig(CHAVE_MENSAGEM_VITRINE);
  const existente = mensagemId ? await vitrine.canal.messages.fetch(mensagemId).catch(() => null) : null;
  if (existente) {
    await existente.edit(mensagemVitrine());
  } else {
    const nova = await vitrine.canal.send(mensagemVitrine());
    await gravarConfig(CHAVE_MENSAGEM_VITRINE, nova.id);
    resumo.push('📌 Mensagem da vitrine publicada');
  }
  return resumo.length ? resumo : ['Tudo já existia'];
}

async function categoriaDaLoja() {
  return lerConfig(CHAVE_CATEGORIA);
}

module.exports = { montarEstruturaLoja, mensagemVitrine, categoriaDaLoja };
