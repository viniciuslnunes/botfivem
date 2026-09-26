const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const { lerConfig, gravarConfig } = require('../botConfig');
const { montarPainel } = require('./mensagem');

// Dois canais públicos para leitura, onde só o bot escreve: um com os sorteios
// em andamento (e o botão de novo sorteio sempre por último) e outro com o
// histórico dos concluídos. Os IDs ficam em bot_config (config é imutável).
const CHAVE_CANAL = 'canal_sorteios';
const CHAVE_HISTORICO = 'canal_sorteios_historico';
const ID_BOTAO_NOVO = 'sorteio:novo';

const LER = [P.ViewChannel, P.ReadMessageHistory];

async function canalPorChave(client, chave) {
  const id = await lerConfig(chave);
  const canal = id ? await client.channels.fetch(id).catch(() => null) : null;
  return canal?.isTextBased() ? canal : null;
}

const canalDeSorteios = client => canalPorChave(client, CHAVE_CANAL);
const canalDeHistorico = client => canalPorChave(client, CHAVE_HISTORICO);

function permissoes(guild) {
  return [
    { id: guild.roles.everyone.id, allow: LER, deny: [P.SendMessages] },
    { id: guild.members.me.id, allow: [...LER, P.SendMessages, P.EmbedLinks, P.ManageMessages, P.MentionEveryone] },
  ];
}

// Cria o que falta (mesma categoria do canal de registros diários) e devolve o resumo
async function montarEstruturaSorteios(guild) {
  await guild.channels.fetch();
  const registrosId = await lerConfig('canal_registros_diarios');
  const registros = registrosId ? guild.channels.cache.get(registrosId) : null;
  const resumo = [];
  for (const [chave, nome, topico] of [
    [CHAVE_CANAL, '🎁・sorteios', 'Sorteios em andamento: brindes de quem colou no dia'],
    [CHAVE_HISTORICO, '📜・historico-sorteios', 'Sorteios concluídos e seus ganhadores'],
  ]) {
    const existenteId = await lerConfig(chave);
    const existente = existenteId ? guild.channels.cache.get(existenteId) : null;
    if (existente) {
      resumo.push(`${nome} já existia: <#${existente.id}>`);
      continue;
    }
    const canal = await guild.channels.create({
      name: nome, type: ChannelType.GuildText, topic: topico, parent: registros?.parentId ?? null,
      permissionOverwrites: permissoes(guild), reason: 'Sorteios da torcida',
    });
    await gravarConfig(chave, canal.id);
    resumo.push(`${nome} criado: ${canal}`);
  }
  return resumo;
}

function ehPainel(mensagem, botId) {
  if (mensagem.author?.id !== botId) return false;
  return (mensagem.components ?? []).some(l => (l.components ?? []).some(c => (c.customId ?? c.data?.custom_id) === ID_BOTAO_NOVO));
}

// O botão de novo sorteio fica SEMPRE por último: cada sorteio publicado apaga o
// painel antigo e o reposta no fim (senão fica enterrado atrás dos sorteios).
async function garantirPainelNoFim(client) {
  try {
    const canal = await canalDeSorteios(client);
    if (!canal) return;
    const recentes = await canal.messages.fetch({ limit: 50 });
    const ultima = [...recentes.values()][0];
    if (ultima && ehPainel(ultima, client.user.id)) return;
    for (const m of recentes.values()) if (ehPainel(m, client.user.id)) await m.delete().catch(() => {});
    await canal.send(montarPainel());
  } catch (err) {
    console.error('[sorteios] erro ao garantir o painel:', err.message);
  }
}

module.exports = { canalDeSorteios, canalDeHistorico, montarEstruturaSorteios, garantirPainelNoFim, ID_BOTAO_NOVO };
