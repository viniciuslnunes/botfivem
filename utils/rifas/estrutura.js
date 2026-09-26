const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const config = require('../../config/index.js');
const { lerConfig, gravarConfig } = require('../botConfig');
const { CHAVE_CANAL_LOGS_GESTAO } = require('../logGestao');
const { buscarDepartamento } = require('../departamentos/repositorio');
const { garantirMensagemFixa } = require('../mensagemFixa');
const { montarPainelRifas } = require('./mensagem');
const tema = require('../../tema');

// Dois canais: o público (só o bot escreve; as rifas e o botão de nova rifa por
// último) e o privado onde a equipe confere os pagamentos avisados pelos
// compradores. Sem o privado, a conferência cai no canal de logs de gestão.
const CHAVE_CANAL_RIFAS = 'canal_rifas';
const CHAVE_CANAL_PAGAMENTOS = 'canal_pagamentos_rifa';
const ID_BOTAO_NOVA = 'rifa:novo';
const LER = [P.ViewChannel, P.ReadMessageHistory];

async function canalPorChaves(client, chaves) {
  for (const chave of chaves) {
    const id = await lerConfig(chave);
    const canal = id ? await client.channels.fetch(id).catch(() => null) : null;
    if (canal?.isTextBased()) return canal;
  }
  return null;
}

const canalDeRifas = client => canalPorChaves(client, [CHAVE_CANAL_RIFAS]);
const canalDePagamentos = client => canalPorChaves(client, [CHAVE_CANAL_PAGAMENTOS, CHAVE_CANAL_LOGS_GESTAO]);

async function montarCanalRifas(guild, resumo) {
  const existenteId = await lerConfig(CHAVE_CANAL_RIFAS);
  const existente = existenteId ? guild.channels.cache.get(existenteId) : null;
  if (existente) {
    resumo.push(`🎟️ Canal de rifas já existia: <#${existente.id}>`);
    return;
  }
  const canal = await guild.channels.create({
    name: '🎟️・rifas',
    type: ChannelType.GuildText,
    topic: 'Rifas da torcida: prêmio, números livres e prazo. Compra só para sócios, pago no jogo',
    permissionOverwrites: [
      { id: guild.roles.everyone.id, allow: LER, deny: [P.SendMessages] },
      { id: guild.members.me.id, allow: [...LER, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ManageMessages] },
    ],
    reason: 'Rifas da torcida',
  });
  await gravarConfig(CHAVE_CANAL_RIFAS, canal.id);
  resumo.push(`🎟️ Canal de rifas criado: ${canal}`);
}

async function montarCanalPagamentos(guild, resumo) {
  const existenteId = await lerConfig(CHAVE_CANAL_PAGAMENTOS);
  let canal = existenteId ? guild.channels.cache.get(existenteId) : null;

  if (canal) {
    resumo.push(`🎟️ Canal de pagamentos já existia: <#${canal.id}>`);
  } else {
    const [social, financeiro] = await Promise.all([buscarDepartamento('social'), buscarDepartamento('financeiro')]);
    const equipe = [config.cargos.presidente, config.cargos.vicePresidente, social?.cargo_gestor_id, financeiro?.cargo_gestor_id]
      .filter(Boolean);
    canal = await guild.channels.create({
      name: '🎟️・rifas-pagamentos',
      type: ChannelType.GuildText,
      topic: 'Conferência dos pagamentos de rifa avisados pelos compradores',
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
        ...equipe.map(id => ({ id, allow: [...LER, P.SendMessages] })),
        { id: guild.members.me.id, allow: [...LER, P.SendMessages, P.EmbedLinks, P.AttachFiles] },
      ],
      reason: 'Rifas da torcida',
    });
    await gravarConfig(CHAVE_CANAL_PAGAMENTOS, canal.id);
    resumo.push(`🎟️ Canal de pagamentos criado: ${canal}`);
    if (!social?.cargo_gestor_id) resumo.push('⚠️ A área Social e Eventos ainda não tem cargo de gestor: só a presidência vê o canal. Rode `/departamentos setup`.');
  }

  const intro = await garantirMensagemFixa(canal, 'intro_rifas_pagamentos', () => ({
    embeds: [{
      color: tema.cor.primaria,
      title: '🎟️ RIFAS — CONFERÊNCIA DE PAGAMENTOS',
      description: 'Quando um comprador avisa que pagou uma rifa no jogo, o aviso cai aqui para a equipe confirmar ou recusar.',
      footer: { text: 'Canal privado: presidência, vice e gestores do Social e do Financeiro' },
    }],
  }));
  if (intro.criada) resumo.push('📌 Mensagem de apresentação publicada');
}

async function montarEstruturaRifas(guild) {
  await guild.channels.fetch();
  const resumo = [];
  await montarCanalRifas(guild, resumo);
  await montarCanalPagamentos(guild, resumo);
  await garantirPainelNoFim(guild.client);
  return resumo;
}

function ehPainel(mensagem, botId) {
  if (mensagem.author?.id !== botId) return false;
  return (mensagem.components ?? []).some(l => (l.components ?? []).some(c => (c.customId ?? c.data?.custom_id) === ID_BOTAO_NOVA));
}

// O painel fica SEMPRE por último: cada rifa publicada apaga o painel antigo e o
// reposta no fim (senão os botões ficam enterrados atrás das rifas).
async function garantirPainelNoFim(client) {
  try {
    const canal = await canalDeRifas(client);
    if (!canal) return;
    const recentes = await canal.messages.fetch({ limit: 50 });
    const ultima = [...recentes.values()][0];
    if (ultima && ehPainel(ultima, client.user.id)) return;
    for (const m of recentes.values()) if (ehPainel(m, client.user.id)) await m.delete().catch(() => {});
    await canal.send(montarPainelRifas());
  } catch (err) {
    console.error('[rifas] erro ao garantir o painel:', err.message);
  }
}

module.exports = { canalDeRifas, canalDePagamentos, montarEstruturaRifas, garantirPainelNoFim, ID_BOTAO_NOVA };
