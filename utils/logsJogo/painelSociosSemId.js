const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const config = require('../../config/index.js');
const { lerConfig, gravarConfig } = require('../botConfig');
const E = require('./estatisticas');

// Canal fixo listando (e mencionando) todo sócio que ainda não tem o ID do
// jogo vinculado ao apelido — pra ele ver que precisa resolver e saber onde
// (o botão VINCULAR ID do painel de jogadores, ver presencaInteracoes.js).
// Recalculado do zero a cada atualização (sem estado de "quem já foi
// avisado"), então quando alguém vincula o ID o apelido muda, o
// guildMemberUpdate dispara a atualização reativa e a menção dele já some
// sozinha da próxima renderização — não tem "marcar como resolvido" manual.
const CONFIG_KEY_CANAL = 'canal_socios_sem_id';
const CONFIG_KEY_MSGS = 'socios_sem_id_message_ids';
// Placar de incentivo: quantos IDs já foram vinculados desde que o aviso
// começou a valer. Vira uma mensagem fixada (fixar = a "aba" de mensagens
// fixadas do canal, sempre visível ali em cima independente de quantas
// mensagens novas entrem depois) e soma sozinho a cada vínculo NOVO feito
// pelo botão VINCULAR ID (ver incrementarContadorVinculados, chamado por
// presencaInteracoes.js) — só conta primeira vinculação, não troca de ID já
// vinculado (isso não reduz a lista de pendentes, então não é o que motiva
// o aviso).
const CONFIG_KEY_CONTADOR = 'socios_sem_id_contador';
const CONFIG_KEY_PLACAR_MSG = 'socios_sem_id_placar_message_id';
const NOME_CANAL = '🆔・socio-sem-id';
const INTERVALO_MIN = 15;
const LIMITE_CONTEUDO = 2000; // limite do Discord pro `content` de uma mensagem
const LIMITE_MENCOES = 100; // limite do Discord pro allowedMentions.users de uma mensagem

const LER = [P.ViewChannel, P.ReadMessageHistory];
const ESCREVER = [...LER, P.SendMessages, P.EmbedLinks];

function permissoesCanal(guild, botId) {
  return [
    { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
    // Sócio só lê (é ele quem vai ser mencionado ali) — quem escreve avisos
    // extras é a liderança ou o próprio bot.
    { id: config.cargos.socio, allow: LER, deny: [P.SendMessages] },
    ...config.lideranca.map(id => ({ id, allow: ESCREVER })),
    { id: botId, allow: [...ESCREVER, P.ManageMessages] },
  ];
}

// Reaproveita o canal já criado (ID salvo em bot_config); cria na mesma
// categoria do painel de jogadores só na primeira vez. Canal apagado manual/
// mente é recriado sozinho na próxima atualização.
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
    reason: 'Lista de sócios sem ID do jogo vinculado ao apelido',
  });
  await gravarConfig(CONFIG_KEY_CANAL, canal.id);
  return canal;
}

async function buscarSociosSemId(guild) {
  await guild.members.fetch();
  return [...guild.members.cache.values()]
    .filter(m => m.roles.cache.has(config.cargos.socio))
    .filter(m => !E.idFivemDoNick(m.nickname ?? m.displayName))
    .sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? '', 'pt-BR'));
}

// Menção só notifica de verdade quando está no `content` da mensagem —
// dentro de embed não pinga ninguém, por isso aqui é tudo texto puro.
// `content` tem limite de 2000 caracteres, então uma lista grande vira
// várias mensagens (páginas), todas mantidas e editadas no mesmo canal.
function montarPaginas(sociosSemId) {
  const cabecalho =
    `🆔 **SÓCIOS SEM ID VINCULADO** (${sociosSemId.length})\n` +
    `Quem está marcado abaixo ainda não tem o ID do jogo vinculado ao apelido. ` +
    `Entre em ${config.logsJogo.canalPainelJogadores ? `<#${config.logsJogo.canalPainelJogadores}>` : 'painel de jogadores'} ` +
    `e clique no botão **VINCULAR ID** pra resolver — ao vincular, sua menção some sozinha daqui.\n\n`;

  if (!sociosSemId.length) return [{ content: `${cabecalho}*Ninguém pendente — todo mundo já vinculou o ID.* 🎉`, ids: [] }];

  const paginas = [];
  let atual = cabecalho;
  let idsAtual = [];
  for (const membro of sociosSemId) {
    const linha = `<@${membro.id}> `;
    // Quebra a página tanto por tamanho (limite de content) quanto por
    // quantidade de menções — allowedMentions.users aceita no máximo 100
    // IDs por mensagem; passar disso faz o Discord rejeitar o envio inteiro
    // (era por isso que nenhuma mensagem saía: a lista tinha mais de 100
    // sócios sem ID e o allowedMentions ia com todos de uma vez).
    const estoura = idsAtual.length && (atual.length + linha.length > LIMITE_CONTEUDO || idsAtual.length >= LIMITE_MENCOES);
    if (estoura) {
      paginas.push({ content: atual.trimEnd(), ids: idsAtual });
      atual = '';
      idsAtual = [];
    }
    atual += linha;
    idsAtual.push(membro.id);
  }
  if (idsAtual.length) paginas.push({ content: atual.trimEnd(), ids: idsAtual });
  return paginas;
}

async function lerMsgIds() {
  try {
    const bruto = await lerConfig(CONFIG_KEY_MSGS);
    return bruto ? JSON.parse(bruto) : [];
  } catch {
    return [];
  }
}

// ── Placar de incentivo (mensagem fixada) ───────────────────────────────

function montarConteudoPlacar(contador) {
  return `📌 **${contador}** ${contador === 1 ? 'ID JÁ FOI VINCULADO' : 'IDS JÁ FORAM VINCULADOS'} desde este aviso — falta o seu? Entre em ` +
    `${config.logsJogo.canalPainelJogadores ? `<#${config.logsJogo.canalPainelJogadores}>` : 'painel de jogadores'} e clique em **VINCULAR ID**!`;
}

async function obterOuCriarPlacar(canal, contador) {
  const salvoId = await lerConfig(CONFIG_KEY_PLACAR_MSG);
  const salvo = salvoId && await canal.messages.fetch(salvoId).catch(() => null);
  if (salvo) return salvo;

  const nova = await canal.send({ content: montarConteudoPlacar(contador), allowedMentions: { parse: [] } });
  await nova.pin().catch(() => {});
  await gravarConfig(CONFIG_KEY_PLACAR_MSG, nova.id);
  return nova;
}

// Chamado por presencaInteracoes.js toda vez que alguém vincula um ID pela
// primeira vez (não em troca de ID já vinculado) — soma 1 no placar fixado
// do canal, pra reforçar visualmente que o aviso está funcionando.
async function incrementarContadorVinculados(client) {
  if (!config.cargos.socio) return;
  const guild = await client.guilds.fetch(config.guildId);
  const canal = await garantirCanal(guild);
  const atual = Number(await lerConfig(CONFIG_KEY_CONTADOR)) || 0;
  const novo = atual + 1;
  await gravarConfig(CONFIG_KEY_CONTADOR, String(novo));
  const msg = await obterOuCriarPlacar(canal, novo);
  await msg.edit({ content: montarConteudoPlacar(novo) }).catch(() => {});
}

async function atualizarPainelSociosSemId(client) {
  if (!config.cargos.socio) return;
  const guild = await client.guilds.fetch(config.guildId);
  const canal = await garantirCanal(guild);
  await obterOuCriarPlacar(canal, Number(await lerConfig(CONFIG_KEY_CONTADOR)) || 0);

  const sociosSemId = await buscarSociosSemId(guild);
  const paginas = montarPaginas(sociosSemId);
  const idsAntigos = await lerMsgIds();
  const idsNovos = [];

  for (let i = 0; i < paginas.length; i++) {
    const conteudo = { content: paginas[i].content, allowedMentions: { users: paginas[i].ids } };
    const idAntigo = idsAntigos[i];
    if (idAntigo) {
      const msg = await canal.messages.fetch(idAntigo).catch(() => null);
      if (msg) {
        await msg.edit(conteudo);
        idsNovos.push(idAntigo);
        continue;
      }
    }
    const nova = await canal.send(conteudo);
    idsNovos.push(nova.id);
  }
  // A lista encolheu (menos páginas que antes): apaga as mensagens que sobraram
  for (const idExtra of idsAntigos.slice(paginas.length)) {
    await canal.messages.delete(idExtra).catch(() => {});
  }
  await gravarConfig(CONFIG_KEY_MSGS, JSON.stringify(idsNovos));
}

function iniciarPainelSociosSemId(client) {
  const atualizar = () => atualizarPainelSociosSemId(client).catch(err => console.error('[socios-sem-id] Erro ao atualizar:', err));
  atualizar();
  setInterval(atualizar, INTERVALO_MIN * 60 * 1000);
}

// Atualização reativa (nick mudou, ganhou/perdeu o cargo SÓCIO): debounced
// igual ao painel de jogadores, pra vários eventos em sequência virarem uma
// edição só.
const DEBOUNCE_MS = 15 * 1000;
let timerPendente = null;
function agendarAtualizacaoReativa(client) {
  if (timerPendente) return;
  timerPendente = setTimeout(() => {
    timerPendente = null;
    atualizarPainelSociosSemId(client).catch(err => console.error('[socios-sem-id] Erro ao atualizar (reativo):', err));
  }, DEBOUNCE_MS);
}

module.exports = { iniciarPainelSociosSemId, agendarAtualizacaoReativa, atualizarPainelSociosSemId, incrementarContadorVinculados };
