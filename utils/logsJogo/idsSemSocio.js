const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const config = require('../../config/index.js');
const { lerConfig, gravarConfig } = require('../botConfig');
const E = require('./estatisticas');
const repositorio = require('./repositorio');
const { buscarBloqueio } = require('../naoRecrutar');

// Canal-espelho do 🆔・socio-sem-id (ver painelSociosSemId.js), só que ao
// contrário: aqui é o ID do jogo que aparece com frequência nos logs (via
// webhook) sem NENHUM membro atual do Discord com esse ID no apelido — ou
// seja, alguém que interage com a torcida dentro do jogo mas ainda nem
// entrou no servidor. Existe pra diretoria saber quem procurar dentro do
// jogo e orientar a entrar no Discord (não dá pra mencionar quem não tem
// conta aqui, por isso é lista de referência pra liderança, não canal
// público como o de sócio sem ID).
const CONFIG_KEY_CANAL = 'canal_ids_sem_socio';
const CONFIG_KEY_MSGS = 'ids_sem_socio_message_ids';
const NOME_CANAL = '🔗・ids-sem-discord';
const INTERVALO_MIN = 20;
const MINIMO_INTERACOES = 3; // filtra aparição isolada/errática nos logs
const LIMITE_DESCRICAO = 3900; // margem abaixo do limite de 4096 da description

function permissoesCanal(guild, botId) {
  return [
    { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
    ...config.lideranca.map(id => ({ id, allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.EmbedLinks] })),
    { id: botId, allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.EmbedLinks, P.ManageMessages] },
  ];
}

// Reaproveita o canal já criado (ID salvo em bot_config); cria na mesma
// categoria do painel de jogadores só na primeira vez, igual ao registro
// diário e ao sócio sem ID.
async function garantirCanal(guild) {
  const salvoId = await lerConfig(CONFIG_KEY_CANAL);
  const salvo = salvoId && await guild.channels.fetch(salvoId).catch(() => null);
  if (salvo) return salvo;

  const painel = config.logsJogo.canalPainelJogadores
    ? await guild.channels.fetch(config.logsJogo.canalPainelJogadores).catch(() => null)
    : null;

  const canal = await guild.channels.create({
    name: NOME_CANAL,
    type: ChannelType.GuildText,
    parent: painel?.parentId ?? null,
    permissionOverwrites: permissoesCanal(guild, guild.members.me.id),
    reason: 'Lista de IDs do jogo frequentes sem Discord vinculado, pra orientação da diretoria',
  });
  await gravarConfig(CONFIG_KEY_CANAL, canal.id);
  return canal;
}

// IDs do jogo já vinculados a ALGUM membro atual (não só sócio — o que
// importa aqui é "já tem Discord", o cargo de sócio é outra etapa).
async function idsVinculadosAtuais(guild) {
  await guild.members.fetch();
  const vinculados = new Set();
  for (const membro of guild.members.cache.values()) {
    const id = E.idFivemDoNick(membro.nickname ?? membro.displayName);
    if (id) vinculados.add(id);
  }
  return vinculados;
}

// Frequentes nos logs, sem membro vinculado e sem bloqueio ativo em
// ❌・não-recrutar (não faz sentido orientar a entrar no Discord quem a
// torcida já decidiu não recrutar).
async function buscarIdsSemDiscord(client, guild) {
  const [frequentes, vinculados] = await Promise.all([
    repositorio.idsFrequentes(MINIMO_INTERACOES),
    idsVinculadosAtuais(guild),
  ]);

  const candidatos = frequentes.filter(r => !vinculados.has(String(r.id)));
  const liberados = [];
  for (const candidato of candidatos) {
    const bloqueio = await buscarBloqueio(client, candidato.id).catch(() => null);
    if (!bloqueio) liberados.push(candidato);
  }
  return liberados;
}

function linhaCandidato(entrada, indice) {
  const ultima = entrada.ultima ? new Date(entrada.ultima).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '?';
  return `${indice + 1}. **${entrada.nome ?? '?'}** \`${entrada.id}\` — ${entrada.total}x · última: ${ultima}`;
}

// Mesmo motivo do registro diário: description em texto corrido, nunca
// `fields` (um field sempre reserva uma linha de nome, mesmo vazio, e
// bagunça a numeração da lista).
function agruparPorOrcamento(linhas, orcamentoPrimeiro, orcamentoDemais) {
  const grupos = [];
  let atual = [];
  let tamanho = 0;
  let orcamento = orcamentoPrimeiro;
  for (const linha of linhas) {
    const acrescimo = linha.length + 1;
    if (atual.length && tamanho + acrescimo > orcamento) {
      grupos.push(atual);
      atual = [];
      tamanho = 0;
      orcamento = orcamentoDemais;
    }
    atual.push(linha);
    tamanho += acrescimo;
  }
  grupos.push(atual);
  return grupos;
}

function montarEmbeds(candidatos) {
  const linhas = candidatos.map((c, i) => linhaCandidato(c, i));
  const cabecalho =
    `Jogadores que interagem com a torcida pelos logs do jogo (${MINIMO_INTERACOES}+ vezes) ` +
    `mas nenhum membro atual do Discord tem esse ID vinculado ao apelido. ` +
    `Procurem dentro do jogo e orientem a entrar no Discord.\n\n`;
  const cabecalhoLista = `**ID · NOME — INTERAÇÕES**\n`;
  const cabecalhoPrimeira = `${cabecalho}${cabecalhoLista}`;
  const orcamentoPrimeira = Math.max(500, LIMITE_DESCRICAO - cabecalhoPrimeira.length);
  const grupos = candidatos.length
    ? agruparPorOrcamento(linhas, orcamentoPrimeira, LIMITE_DESCRICAO)
    : [[]];

  return grupos.map((grupo, i) => ({
    color: 0x000000,
    title: i === 0 ? `🔗 IDS SEM DISCORD (${candidatos.length})` : null,
    description: i === 0
      ? `${cabecalhoPrimeira}${grupo.join('\n') || '*Ninguém pendente — todo ID frequente já tem alguém no Discord.* 🎉'}`
      : `*(continuação)*\n\n${grupo.join('\n')}`,
    footer: {
      text: `Com base nos logs do jogo recebidos pelo webhook`
        + (grupos.length > 1 ? ` · Página ${i + 1}/${grupos.length}` : ''),
    },
    timestamp: new Date().toISOString(),
  }));
}

async function lerMsgIds() {
  try {
    const bruto = await lerConfig(CONFIG_KEY_MSGS);
    return bruto ? JSON.parse(bruto) : [];
  } catch {
    return [];
  }
}

async function atualizarIdsSemSocio(client) {
  const guild = await client.guilds.fetch(config.guildId);
  const canal = await garantirCanal(guild);

  const candidatos = await buscarIdsSemDiscord(client, guild);
  const embeds = montarEmbeds(candidatos);
  const idsAntigos = await lerMsgIds();
  const idsNovos = [];

  for (let i = 0; i < embeds.length; i++) {
    const idAntigo = idsAntigos[i];
    if (idAntigo) {
      const msg = await canal.messages.fetch(idAntigo).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embeds[i]], allowedMentions: { parse: [] } });
        idsNovos.push(idAntigo);
        continue;
      }
    }
    const nova = await canal.send({ embeds: [embeds[i]], allowedMentions: { parse: [] } });
    idsNovos.push(nova.id);
  }
  for (const idExtra of idsAntigos.slice(embeds.length)) {
    await canal.messages.delete(idExtra).catch(() => {});
  }
  await gravarConfig(CONFIG_KEY_MSGS, JSON.stringify(idsNovos));
}

function iniciarIdsSemSocio(client) {
  const atualizar = () => atualizarIdsSemSocio(client).catch(err => console.error('[ids-sem-socio] Erro ao atualizar:', err));
  atualizar();
  setInterval(atualizar, INTERVALO_MIN * 60 * 1000);
}

// Atualização reativa: log novo com ID do jogo, ou apelido de membro que
// mudou (pode ter acabado de vincular um ID) — debounced pra uma rajada de
// eventos virar uma edição só.
const DEBOUNCE_MS = 30 * 1000;
let timerPendente = null;
function agendarAtualizacaoReativa(client) {
  if (timerPendente) return;
  timerPendente = setTimeout(() => {
    timerPendente = null;
    atualizarIdsSemSocio(client).catch(err => console.error('[ids-sem-socio] Erro ao atualizar (reativo):', err));
  }, DEBOUNCE_MS);
}

module.exports = { iniciarIdsSemSocio, agendarAtualizacaoReativa, atualizarIdsSemSocio };
