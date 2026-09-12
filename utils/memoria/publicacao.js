const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const config = require('../../config/index.js');
const { lerConfig, gravarConfig } = require('../botConfig');
const { urlDaMidia } = require('../arquivoMidia');
const { TIPOS_EVENTO, resumirPresenca } = require('../eventos/regras');
const repo = require('./repositorio');
const { tituloDoDia, formatarDia } = require('./regras');

// A memória é um fórum: um tópico por dia civil. O eixo é o dia, não o feed.
const CHAVE_FORUM = 'canal_forum_memoria';

async function montarEstruturaMemoria(guild) {
  const id = await lerConfig(CHAVE_FORUM);
  if (id && guild.channels.cache.get(id)) return { criado: false, canalId: id };
  const forum = await guild.channels.create({
    name: '📜・memoria',
    type: ChannelType.GuildForum,
    topic: 'Linha do tempo da torcida: um tópico por dia marcante.',
    reason: 'Memória da torcida',
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
      // Sócio lê; quem publica é o bot (fato aprovado, resumo de evento)
      { id: config.cargos.socio, allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads] },
      ...config.lideranca.map(cargo => ({ id: cargo, allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessagesInThreads] })),
      { id: guild.members.me.id, allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.SendMessagesInThreads, P.ManageThreads, P.EmbedLinks, P.AttachFiles] },
    ],
  });
  await gravarConfig(CHAVE_FORUM, forum.id);
  return { criado: true, canalId: forum.id };
}

async function obterTopicoDoDia(client, dia) {
  const forumId = await lerConfig(CHAVE_FORUM);
  const forum = forumId ? await client.channels.fetch(forumId).catch(() => null) : null;
  if (!forum) throw new Error('Fórum da memória não configurado. Rode /memoria setup.');

  const threadId = await repo.threadDoDia(dia);
  const existente = threadId ? await client.channels.fetch(threadId).catch(() => null) : null;
  if (existente) return existente;

  const topico = await forum.threads.create({
    name: tituloDoDia(dia),
    message: { content: `🦅 **Memória da torcida — ${formatarDia(dia)}**` },
    reason: 'Memória da torcida',
  });
  await repo.gravarThreadDoDia(dia, topico.id);
  return topico;
}

async function publicarFato(client, fato) {
  const dia = fato.dia_chave ?? (fato.dia instanceof Date ? fato.dia.toISOString().slice(0, 10) : String(fato.dia).slice(0, 10));
  const topico = await obterTopicoDoDia(client, dia);
  const imagem = await urlDaMidia(client, fato.midia_ref);
  const mensagem = await topico.send({
    embeds: [{
      color: 0x000000,
      description: fato.texto,
      fields: [{ name: 'REGISTRADO POR', value: `<@${fato.autor_id}>`, inline: true }],
      ...(imagem ? { image: { url: imagem } } : {}),
    }],
    allowedMentions: { parse: [] },
  });
  await repo.gravarPublicacao(fato.id, mensagem.url);
  return mensagem;
}

// Evento realizado vira registro do dia automaticamente
async function publicarResumoEvento(client, evento, inscricoes) {
  const p = resumirPresenca(inscricoes);
  if (!p.presentes) return null;
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(evento.inicio_em));
  const topico = await obterTopicoDoDia(client, dia);
  const tipo = TIPOS_EVENTO[evento.tipo] ?? TIPOS_EVENTO.GERAL;
  return topico.send({
    embeds: [{
      color: 0x000000,
      title: `${tipo.emoji} ${evento.titulo.toUpperCase()}`,
      description: `${p.presentes} presente${p.presentes !== 1 ? 's' : ''}${evento.local ? ` · 📍 ${evento.local}` : ''}`,
    }],
  });
}

module.exports = { montarEstruturaMemoria, publicarFato, publicarResumoEvento, obterTopicoDoDia };
