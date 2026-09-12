const {
  ChannelType, PermissionFlagsBits: P, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder,
} = require('discord.js');
const config = require('../../config/index.js');
const { lerConfig, gravarConfig } = require('../botConfig');
const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
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
// IDs trocam a cada season do jogo — o mesmo jogador pode aparecer aqui de
// novo com um ID novo depois de já ter sido resolvido (correlacionado com
// um membro, ou marcado como "não interessa"). Guardado à parte (não como
// campo do candidato, que é recalculado do zero a cada atualização) pra
// sobreviver entre atualizações. Ver ignorarId/reativarId.
const CONFIG_KEY_IGNORADOS = 'ids_sem_socio_ignorados';
// Sugestão de correlação (nome parecido) que a liderança já olhou e
// confirmou que NÃO é a mesma pessoa — pra não ficar sugerindo o mesmo par
// errado toda atualização. Só o par específico entra na lista negra, o ID
// continua pendente normalmente.
const CONFIG_KEY_SUGESTOES_REJEITADAS = 'ids_sem_socio_sugestoes_rejeitadas';
const NOME_CANAL = '🔗・ids-sem-discord';
const INTERVALO_MIN = 20;
const MINIMO_INTERACOES = 3; // filtra aparição isolada/errática nos logs
const LIMITE_DESCRICAO = 3900; // margem abaixo do limite de 4096 da description
const LIMIAR_SUGESTAO = 0.72; // similaridade mínima (0-1) pra sugerir correlação por nome

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

// ── Persistência: ignorados e sugestões rejeitadas ──────────────────────

async function lerLista(chave) {
  try {
    const bruto = await lerConfig(chave);
    return bruto ? JSON.parse(bruto) : [];
  } catch {
    return [];
  }
}
const lerIgnorados = () => lerLista(CONFIG_KEY_IGNORADOS);
const lerRejeitadas = () => lerLista(CONFIG_KEY_SUGESTOES_REJEITADAS);
const gravarIgnorados = lista => gravarConfig(CONFIG_KEY_IGNORADOS, JSON.stringify(lista));
const gravarRejeitadas = lista => gravarConfig(CONFIG_KEY_SUGESTOES_REJEITADAS, JSON.stringify(lista));

// Marca um ID como resolvido (correlacionado com um membro já registrado,
// ou simplesmente "não interessa avisar") — some da lista até alguém
// reverter manualmente (ver reativarId). `nome`/`total`/`ultima` ficam
// salvos junto pra "VER IGNORADOS" mostrar sem precisar reconsultar o banco.
async function ignorarId(candidato, motivo, porUserId) {
  const ignorados = await lerIgnorados();
  const semEsse = ignorados.filter(r => String(r.id) !== String(candidato.id));
  semEsse.push({
    id: candidato.id, nome: candidato.nome ?? null, total: candidato.total ?? null, ultima: candidato.ultima ?? null,
    motivo, ignoradoPor: porUserId, ignoradoEm: new Date().toISOString(),
  });
  await gravarIgnorados(semEsse);
}

async function reativarId(id) {
  const ignorados = await lerIgnorados();
  await gravarIgnorados(ignorados.filter(r => String(r.id) !== String(id)));
}

async function rejeitarSugestao(candidatoId, discordId) {
  const rejeitadas = await lerRejeitadas();
  const par = `${candidatoId}:${discordId}`;
  if (!rejeitadas.includes(par)) rejeitadas.push(par);
  await gravarRejeitadas(rejeitadas);
}

// ── Correlação por nome (troca de ID de season) ─────────────────────────

// Nick do Discord no padrão "S GDF | Nome - 1234" (ver formatarNick.js):
// pega só o "Nome" do meio, sem o prefixo de cargo nem o ID no fim, pra
// comparar com o nome cru que vem do log do jogo.
function nomeDoNick(nick) {
  const semId = String(nick ?? '').replace(/\s*-\s*\d{1,8}\s*$/, '');
  const semPrefixo = semId.includes('|') ? semId.slice(semId.lastIndexOf('|') + 1) : semId;
  return semPrefixo.trim();
}

function normalizarNome(str) {
  return String(str ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // acentos
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Distância de Levenshtein básica — strings curtas (nomes de jogador), sem
// necessidade de biblioteca externa.
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let anterior = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const linha = [i];
    for (let j = 1; j <= n; j++) {
      linha[j] = a[i - 1] === b[j - 1]
        ? anterior[j - 1]
        : 1 + Math.min(anterior[j - 1], anterior[j], linha[j - 1]);
    }
    anterior = linha;
  }
  return anterior[n];
}

function similaridadeBruta(a, b) {
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

// Comparação em duas passadas: com espaço (pega nome/sobrenome fora de
// ordem) e sem espaço (neutraliza "L.H.P." virando "l h p" contra "Lhp" —
// mesmo apelido, pontuação diferente). Fica com a maior das duas, já que
// qualquer uma bater é sinal forte de ser o mesmo nome.
function similaridade(a, b) {
  return Math.max(similaridadeBruta(a, b), similaridadeBruta(a.replace(/ /g, ''), b.replace(/ /g, '')));
}

// Melhor membro atual do Discord cujo nome (sem prefixo/ID) é parecido com o
// nome que veio do log — indício de que o ID antigo (season anterior) já
// virou outro no apelido dele. Não afirma nada sozinho, só sugere: quem
// confirma é a liderança (ver módulo de interação, ação "confirmar").
function encontrarSugestao(nomeCandidato, membros) {
  const alvo = normalizarNome(nomeCandidato);
  if (!alvo) return null;
  let melhor = null;
  for (const m of membros) {
    const nomeM = normalizarNome(nomeDoNick(m.nick));
    if (!nomeM) continue;
    const score = similaridade(alvo, nomeM);
    if (score >= LIMIAR_SUGESTAO && (!melhor || score > melhor.score)) {
      melhor = { discordId: m.id, nome: nomeM, score };
    }
  }
  return melhor;
}

async function membrosAtuais(guild) {
  await guild.members.fetch();
  return [...guild.members.cache.values()]
    .filter(m => !m.user.bot)
    .map(m => ({ id: m.id, nick: m.nickname ?? m.displayName }));
}

// Frequentes nos logs, sem membro vinculado, sem bloqueio ativo em
// ❌・não-recrutar (não faz sentido orientar a entrar no Discord quem a
// torcida já decidiu não recrutar) e sem estar marcado como ignorado. Cada
// candidato liberado ganha uma sugestão de correlação, se houver.
async function buscarIdsSemDiscord(client, guild) {
  const [frequentes, membros, ignorados, rejeitadas] = await Promise.all([
    repositorio.idsFrequentes(MINIMO_INTERACOES),
    membrosAtuais(guild),
    lerIgnorados(),
    lerRejeitadas(),
  ]);

  const ignoradosSet = new Set(ignorados.map(r => String(r.id)));
  const rejeitadasSet = new Set(rejeitadas);
  const vinculados = new Set(membros.map(m => E.idFivemDoNick(m.nick)).filter(Boolean));

  const candidatos = frequentes.filter(r => !vinculados.has(String(r.id)) && !ignoradosSet.has(String(r.id)));
  const liberados = [];
  for (const candidato of candidatos) {
    const bloqueio = await buscarBloqueio(client, candidato.id).catch(() => null);
    if (bloqueio) continue;
    const sugestao = encontrarSugestao(candidato.nome, membros);
    liberados.push({
      ...candidato,
      sugestao: sugestao && !rejeitadasSet.has(`${candidato.id}:${sugestao.discordId}`) ? sugestao : null,
    });
  }
  return liberados;
}

function linhaCandidato(entrada, indice) {
  const ultima = entrada.ultima ? new Date(entrada.ultima).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '?';
  const sugestao = entrada.sugestao ? ` · possível <@${entrada.sugestao.discordId}>?` : '';
  return `${indice + 1}. **${entrada.nome ?? '?'}** \`${entrada.id}\` — ${entrada.total}x · última: ${ultima}${sugestao}`;
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
    `Procurem dentro do jogo e orientem a entrar no Discord. Quando o nome bate com o de ` +
    `alguém já no servidor, aparece "possível @menção?" — use 🔎 RESOLVER PENDENTE pra confirmar ou descartar.\n\n`;
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

function linhaBotoesGerenciar() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('idsemsocio:resolver').setLabel('RESOLVER PENDENTE').setEmoji('🔎').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('idsemsocio:verignorados').setLabel('VER IGNORADOS').setEmoji('🗂️').setStyle(ButtonStyle.Secondary)
  );
}

async function lerMsgIds() {
  try {
    const bruto = await lerConfig(CONFIG_KEY_MSGS);
    return bruto ? JSON.parse(bruto) : [];
  } catch {
    return [];
  }
}

// Última lista calculada, guardada em memória pra alimentar a busca do
// botão RESOLVER PENDENTE sem precisar reconsultar banco/guild a cada
// interação — atualizada toda vez que o painel atualiza (reativo ou pelo
// ciclo de 20 min), então nunca fica mais desatualizada que o canal em si.
let ultimosCandidatos = [];

async function atualizarIdsSemSocio(client) {
  const guild = await client.guilds.fetch(config.guildId);
  const canal = await garantirCanal(guild);

  const candidatos = await buscarIdsSemDiscord(client, guild);
  ultimosCandidatos = candidatos;
  const embeds = montarEmbeds(candidatos);
  const idsAntigos = await lerMsgIds();
  const idsNovos = [];

  for (let i = 0; i < embeds.length; i++) {
    const payload = { embeds: [embeds[i]], components: i === 0 ? [linhaBotoesGerenciar()] : [], allowedMentions: { parse: [] } };
    const idAntigo = idsAntigos[i];
    if (idAntigo) {
      const msg = await canal.messages.fetch(idAntigo).catch(() => null);
      if (msg) {
        await msg.edit(payload);
        idsNovos.push(idAntigo);
        continue;
      }
    }
    const nova = await canal.send(payload);
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

// ── Interação: RESOLVER PENDENTE / VER IGNORADOS ────────────────────────
// Mesmo padrão botão → select → (ação) usado no resto do bot: um botão
// único abre um modal de busca (não cabe botão por linha — a lista pode
// ter centenas de itens), o resultado vira um select de até 25 opções, e a
// escolha mostra a ficha do candidato com os botões de ação cabíveis.

function modalBuscar(customId, titulo) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(titulo)
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('termo').setLabel('NOME OU ID').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)));
}

function buscarEmLista(lista, termoBruto) {
  const termo = normalizarNome(termoBruto);
  const porId = termoBruto.trim();
  return lista.filter(e => normalizarNome(e.nome).includes(termo) || String(e.id).includes(porId));
}

function selectDeResultado(customId, entradas, descricaoFn) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(entradas.length > 25 ? `${entradas.length} ENCONTRADOS (MOSTRANDO 25) — ESCOLHA` : `${entradas.length} ENCONTRADO(S) — ESCOLHA`)
    .addOptions(entradas.slice(0, 25).map(e => ({
      label: `${e.nome ?? '?'} — ${e.id}`.slice(0, 100),
      value: String(e.id),
      description: descricaoFn(e).slice(0, 100),
    })));
  return new ActionRowBuilder().addComponents(select);
}

function embedFichaPendente(c) {
  const ultima = c.ultima ? new Date(c.ultima).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '?';
  const linhas = [
    `**ID:** \`${c.id}\``,
    `**Interações nos logs:** ${c.total}x`,
    `**Última aparição:** ${ultima}`,
  ];
  if (c.sugestao) linhas.push(`**Possível correlação:** <@${c.sugestao.discordId}> (${Math.round(c.sugestao.score * 100)}% de nome parecido)`);
  return { color: 0x000000, title: `🔗 ${c.nome ?? '?'}`, description: linhas.join('\n') };
}

function botoesPendente(c) {
  const botoes = [];
  if (c.sugestao) {
    botoes.push(
      new ButtonBuilder().setCustomId(`idsemsocio:confirmar:${c.id}:${c.sugestao.discordId}`).setLabel('É ELE — IGNORAR ESTE ID').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`idsemsocio:rejeitarsugestao:${c.id}:${c.sugestao.discordId}`).setLabel('NÃO É ELE').setEmoji('❌').setStyle(ButtonStyle.Secondary)
    );
  }
  botoes.push(new ButtonBuilder().setCustomId(`idsemsocio:ignorar:${c.id}`).setLabel('IGNORAR (SEM CORRELAÇÃO)').setEmoji('🚫').setStyle(ButtonStyle.Danger));
  return new ActionRowBuilder().addComponents(botoes);
}

function embedFichaIgnorado(r) {
  const em = r.ignoradoEm ? new Date(r.ignoradoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '?';
  return {
    color: 0x000000,
    title: `🗂️ ${r.nome ?? '?'}`,
    description: [
      `**ID:** \`${r.id}\``,
      `**Motivo:** ${r.motivo ?? 'não informado'}`,
      `**Ignorado por:** <@${r.ignoradoPor}> em ${em}`,
    ].join('\n'),
  };
}

function botoesIgnorado(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`idsemsocio:reativar:${id}`).setLabel('REATIVAR (VOLTAR PRA LISTA)').setEmoji('↩️').setStyle(ButtonStyle.Secondary)
  );
}

registrarModulo('idsemsocio', async interaction => {
  const [, acao, a, b] = interaction.customId.split(':');

  if (interaction.isButton() && acao === 'resolver') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    return interaction.showModal(modalBuscar('idsemsocio:resolvermodal', 'BUSCAR ID PENDENTE'));
  }

  if (interaction.isButton() && acao === 'verignorados') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    return interaction.showModal(modalBuscar('idsemsocio:ignoradosmodal', 'BUSCAR ID IGNORADO'));
  }

  if (interaction.isModalSubmit() && acao === 'resolvermodal') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const termo = interaction.fields.getTextInputValue('termo');
    const encontrados = buscarEmLista(ultimosCandidatos, termo);
    if (!encontrados.length) return interaction.reply({ content: `❌ NENHUM ID PENDENTE ENCONTRADO PARA \`${termo}\`.`, flags: 64 });
    const selectRow = selectDeResultado('idsemsocio:selpendente', encontrados, e => e.sugestao ? `${e.total}x · possível correlação` : `${e.total}x`);
    return interaction.reply({ content: `🔎 BUSCA POR \`${termo}\`:`, components: [selectRow], flags: 64 });
  }

  if (interaction.isModalSubmit() && acao === 'ignoradosmodal') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const termo = interaction.fields.getTextInputValue('termo');
    const ignorados = await lerIgnorados();
    const encontrados = buscarEmLista(ignorados, termo);
    if (!encontrados.length) return interaction.reply({ content: `❌ NENHUM ID IGNORADO ENCONTRADO PARA \`${termo}\`.`, flags: 64 });
    const selectRow = selectDeResultado('idsemsocio:selignorado', encontrados, e => e.motivo ?? 'ignorado');
    return interaction.reply({ content: `🗂️ BUSCA POR \`${termo}\`:`, components: [selectRow], flags: 64 });
  }

  if (interaction.isStringSelectMenu() && acao === 'selpendente') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const c = ultimosCandidatos.find(e => String(e.id) === interaction.values[0]);
    if (!c) return interaction.reply({ content: '❌ ESSE ID NÃO ESTÁ MAIS PENDENTE (A LISTA JÁ ATUALIZOU).', flags: 64 });
    return interaction.reply({ embeds: [embedFichaPendente(c)], components: [botoesPendente(c)], flags: 64, allowedMentions: { parse: [] } });
  }

  if (interaction.isStringSelectMenu() && acao === 'selignorado') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const ignorados = await lerIgnorados();
    const r = ignorados.find(e => String(e.id) === interaction.values[0]);
    if (!r) return interaction.reply({ content: '❌ ESSE ID NÃO ESTÁ MAIS NA LISTA DE IGNORADOS.', flags: 64 });
    return interaction.reply({ embeds: [embedFichaIgnorado(r)], components: [botoesIgnorado(r.id)], flags: 64, allowedMentions: { parse: [] } });
  }

  if (interaction.isButton() && acao === 'confirmar') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const c = ultimosCandidatos.find(e => String(e.id) === a);
    if (!c) return interaction.reply({ content: '❌ ESSE ID NÃO ESTÁ MAIS PENDENTE (A LISTA JÁ ATUALIZOU).', flags: 64 });
    await ignorarId(c, `correlacionado com <@${b}> (season anterior)`, interaction.user.id);
    agendarAtualizacaoReativa(interaction.client);
    return interaction.reply({ content: `✅ ID \`${a}\` MARCADO COMO <@${b}> — SAI DA LISTA.`, flags: 64, allowedMentions: { parse: [] } });
  }

  if (interaction.isButton() && acao === 'rejeitarsugestao') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await rejeitarSugestao(a, b);
    agendarAtualizacaoReativa(interaction.client);
    return interaction.reply({ content: `❌ SUGESTÃO DESCARTADA — ID \`${a}\` CONTINUA PENDENTE, SEM ESSA CORRELAÇÃO.`, flags: 64 });
  }

  if (interaction.isButton() && acao === 'ignorar') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const c = ultimosCandidatos.find(e => String(e.id) === a) ?? { id: a };
    await ignorarId(c, `ignorado manualmente por <@${interaction.user.id}>`, interaction.user.id);
    agendarAtualizacaoReativa(interaction.client);
    return interaction.reply({ content: `🚫 ID \`${a}\` IGNORADO — SAI DA LISTA (USE VER IGNORADOS PRA REVERTER).`, flags: 64 });
  }

  if (interaction.isButton() && acao === 'reativar') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await reativarId(a);
    agendarAtualizacaoReativa(interaction.client);
    return interaction.reply({ content: `↩️ ID \`${a}\` REATIVADO — VOLTA A APARECER NA LISTA SE AINDA ESTIVER PENDENTE.`, flags: 64 });
  }
});

module.exports = { iniciarIdsSemSocio, agendarAtualizacaoReativa, atualizarIdsSemSocio };
