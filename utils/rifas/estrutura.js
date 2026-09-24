const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const config = require('../../config/index.js');
const { lerConfig, gravarConfig } = require('../botConfig');
const { CHAVE_CANAL_LOGS_GESTAO } = require('../logGestao');
const { buscarDepartamento } = require('../departamentos/repositorio');
const { garantirMensagemFixa } = require('../mensagemFixa');
const tema = require('../../tema');

// Canal privado onde a equipe confere os pagamentos avisados pelos compradores.
// Sem ele, a conferência cai no canal de logs de gestão.
const CHAVE_CANAL_PAGAMENTOS = 'canal_pagamentos_rifa';
const LER = [P.ViewChannel, P.ReadMessageHistory];

async function canalDePagamentos(client) {
  for (const chave of [CHAVE_CANAL_PAGAMENTOS, CHAVE_CANAL_LOGS_GESTAO]) {
    const id = await lerConfig(chave);
    const canal = id ? await client.channels.fetch(id).catch(() => null) : null;
    if (canal?.isTextBased()) return canal;
  }
  return null;
}

async function montarEstruturaRifas(guild) {
  await guild.channels.fetch();
  const existenteId = await lerConfig(CHAVE_CANAL_PAGAMENTOS);
  const resumo = [];
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
  return resumo;
}

module.exports = { canalDePagamentos, montarEstruturaRifas };
