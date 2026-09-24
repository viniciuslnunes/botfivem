const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../config/index.js');
const repo = require('./repositorio');
const { TIPOS_EVENTO, inscricoesAbertas, resumirPresenca, formatarTaxa } = require('./regras');
const { listaLimitada } = require('../departamentos/regras');
const tema = require('../../tema');

// A mensagem do evento é sempre reconstruída a partir do banco — nunca editada "de cabeça"

function unix(data) {
  return Math.floor(new Date(data).getTime() / 1000);
}

function montarMensagemEvento(evento, inscricoes, agora = new Date()) {
  const tipo = TIPOS_EVENTO[evento.tipo] ?? TIPOS_EVENTO.GERAL;
  const area = evento.area_slug ? config.departamentos.find(d => d.slug === evento.area_slug) : null;
  const confirmados = inscricoes.filter(i => i.status === 'CONFIRMADO');
  const espera = inscricoes.filter(i => i.status === 'ESPERA');
  const cancelado = evento.status === 'CANCELADO';
  const abertas = inscricoesAbertas(evento, agora);
  const comecou = new Date(evento.inicio_em).getTime() <= agora.getTime();

  const fields = [
    { name: '🕐 QUANDO', value: `<t:${unix(evento.inicio_em)}:F> (<t:${unix(evento.inicio_em)}:R>)`, inline: false },
  ];
  if (evento.local) fields.push({ name: '📍 LOCAL', value: evento.local, inline: true });
  if (area) fields.push({ name: '🏛️ ÁREA', value: `${area.emoji} ${area.nome}`, inline: true });
  fields.push({
    name: '🎟️ VAGAS',
    value: evento.capacidade ? `${confirmados.length}/${evento.capacidade}` : `${confirmados.length} confirmado${confirmados.length !== 1 ? 's' : ''}`,
    inline: true,
  });
  fields.push({
    name: `${tema.emoji.ok} CONFIRMADOS (${confirmados.length})`,
    value: confirmados.length ? listaLimitada(confirmados.map(i => `<@${i.discord_id}>`), 1000) : '*Ninguém confirmou ainda.*',
    inline: false,
  });
  if (espera.length) {
    fields.push({
      name: `⏳ LISTA DE ESPERA (${espera.length})`,
      value: listaLimitada(espera.map((i, n) => `${n + 1}. <@${i.discord_id}>`), 1000),
      inline: false,
    });
  }
  if (comecou && !cancelado) {
    const p = resumirPresenca(inscricoes);
    fields.push({
      name: '📋 PRESENÇA',
      value: `${p.presentes} presente${p.presentes !== 1 ? 's' : ''} · taxa ${formatarTaxa(p.taxa)}${p.avulsos ? ` · ${p.avulsos} sem confirmar` : ''}`,
      inline: false,
    });
  }

  const embed = {
    color: cancelado ? tema.cor.perigo : tema.cor.primaria,
    title: `${cancelado ? '❌ CANCELADO — ' : ''}${tipo.emoji} ${evento.titulo.toUpperCase()}`,
    description: evento.descricao || null,
    fields,
    footer: {
      text: `EVENTO #${evento.id} · ${tipo.rotulo.toUpperCase()}${abertas ? '' : cancelado ? '' : ' · INSCRIÇÕES ENCERRADAS'}`,
    },
  };

  const components = cancelado ? [] : [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`evt:confirmar:${evento.id}`).setLabel('CONFIRMAR').setEmoji(tema.emoji.ok)
        .setStyle(ButtonStyle.Secondary).setDisabled(!abertas),
      new ButtonBuilder().setCustomId(`evt:desistir:${evento.id}`).setLabel('DESISTIR')
        .setStyle(ButtonStyle.Secondary).setDisabled(!abertas),
      new ButtonBuilder().setCustomId(`evt:presenca:${evento.id}`).setLabel('PRESENÇA').setEmoji('📋')
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

async function publicarEvento(client, evento) {
  const canal = await client.channels.fetch(evento.canal_id).catch(() => null);
  if (!canal?.isTextBased()) throw new Error(`Canal do evento #${evento.id} não encontrado.`);
  const mensagem = await canal.send(montarMensagemEvento(evento, await repo.listarInscricoes(evento.id)));
  await repo.gravarMensagem(evento.id, mensagem.id);
  return mensagem;
}

async function atualizarMensagemEvento(client, eventoId) {
  const evento = await repo.buscarEvento(eventoId);
  if (!evento?.message_id) return;
  const canal = await client.channels.fetch(evento.canal_id).catch(() => null);
  const mensagem = canal ? await canal.messages.fetch(evento.message_id).catch(() => null) : null;
  if (!mensagem) return;
  await mensagem.edit(montarMensagemEvento(evento, await repo.listarInscricoes(evento.id)));
}

function linkDaMensagem(evento) {
  return evento.message_id
    ? `https://discord.com/channels/${config.guildId}/${evento.canal_id}/${evento.message_id}`
    : null;
}

module.exports = { montarMensagemEvento, publicarEvento, atualizarMensagemEvento, linkDaMensagem };
