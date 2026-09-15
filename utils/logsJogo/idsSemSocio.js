const {
  ChannelType, PermissionFlagsBits: P, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  StringSelectMenuBuilder, UserSelectMenuBuilder,
  escapeMarkdown,
} = require('discord.js');
const config = require('../../config/index.js');
const { lerConfig, gravarConfig } = require('../botConfig');
const { garantirMembrosCarregados } = require('../membrosGuild');
const { aplicarIdNoNick } = require('../formatarNick');
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
// Canal separado só pra RESOLVER PENDENTE/VER IGNORADOS (e tudo que vem
// depois: fichas, selects). Existia junto do canal de listagem, com a
// mensagem de botões fixada como a mais antiga do canal (ver
// garantirMsgBotoes) — mas resposta ephemeral do Discord não nasce "colada"
// no botão que a gerou, nasce como mensagem nova no FIM da timeline do
// canal. Com a listagem paginada inteira entre o botão e o fim, cada clique
// exigia rolar por tudo isso pra achar o select. Canal isolado, sem lista
// nenhuma, tira esse "fim" gigante do meio: a resposta nasce logo abaixo do
// botão de verdade.
const CONFIG_KEY_CANAL_GERENCIAR = 'canal_ids_sem_socio_gerenciar';
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
const NOME_CANAL_GERENCIAR = '🔎・gerenciar-ids-sem-discord';
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

// Mesma categoria do canal de listagem, mas canal à parte — só a mensagem de
// botões (RESOLVER PENDENTE/VER IGNORADOS) e as respostas ephemeral que ela
// gera. Ver comentário de CONFIG_KEY_CANAL_GERENCIAR.
async function garantirCanalGerenciar(guild, canalListagem) {
  const salvoId = await lerConfig(CONFIG_KEY_CANAL_GERENCIAR);
  const salvo = salvoId && await guild.channels.fetch(salvoId).catch(() => null);
  if (salvo) return salvo;

  const canal = await guild.channels.create({
    name: NOME_CANAL_GERENCIAR,
    type: ChannelType.GuildText,
    parent: canalListagem?.parentId ?? null,
    permissionOverwrites: permissoesCanal(guild, guild.members.me.id),
    reason: 'Botões de gerenciamento de IDs sem Discord, separados da listagem pra resposta ephemeral não nascer atrás de uma lista inteira',
  });
  await gravarConfig(CONFIG_KEY_CANAL_GERENCIAR, canal.id);
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
// reverter manualmente (ver reativarId) ou até a reconciliação automática
// perceber que a associação não colou de verdade (ver reconciliarIgnorados).
// `associadoA` (Discord ID) só é passado nos dois fluxos de associação
// (confirmar sugestão / selecionar membro na mão) — é o que permite essa
// reconciliação depois; ignorar manual "sem correlação nenhuma" não tem
// membro pra conferir, então fica null e nunca é revertido sozinho.
// `nome`/`total`/`ultima` ficam salvos junto pra "VER IGNORADOS" mostrar sem
// precisar reconsultar o banco.
async function ignorarId(candidato, motivo, porUserId, associadoA = null) {
  const ignorados = await lerIgnorados();
  const semEsse = ignorados.filter(r => String(r.id) !== String(candidato.id));
  semEsse.push({
    id: candidato.id, nome: candidato.nome ?? null, total: candidato.total ?? null, ultima: candidato.ultima ?? null,
    motivo, ignoradoPor: porUserId, ignoradoEm: new Date().toISOString(), associadoA,
  });
  await gravarIgnorados(semEsse);
}

// Um ID "associado" (ver `associadoA` acima) só deve continuar fora da lista
// enquanto o membro pra quem foi associado ainda tiver ESSE id no apelido de
// verdade. Sem essa conferência, um apelido revertido depois (na mão pelo
// próprio sócio, ou por qualquer outro fluxo que reescreva o nick), ou uma
// associação que nunca colou (rename falhou mas foi marcado ignorado do
// mesmo jeito, bug já corrigido nos handlers CONFIRMAR/SELECIONARMEMBRO),
// deixava o ID "resolvido" pra sempre em `ids_sem_socio_ignorados`, mesmo o
// vínculo nunca tendo existido de verdade — foi o que aconteceu com o Cris
// Sabará e o Lucas Gdf: apareciam em VER IGNORADOS como "associado", mas o
// apelido nunca tinha o ID, e o sócio ficava pendente em 🆔・socio-sem-id sem
// jeito de ser resolvido de novo por aqui. Ignorados "sem correlação"
// nenhuma não entram nessa checagem — não tem membro pra conferir, e
// continuam dependendo só da reativação manual (VER IGNORADOS).
//
// `associadoA` só existe em registros gravados depois desse fix; pra
// reconciliar os que já ficaram presos antes (sem o campo), cai pro Discord
// ID mencionado dentro do próprio `motivo` — só quando o motivo É de
// associação ("associado a <@123...>" / "associado manualmente a <@123...>
// por <@456...>"): o texto de "ignorado manualmente por <@456...>" (sem
// correlação nenhuma) também tem uma menção, só que é de quem ignorou, não
// de um membro associado — cair nela reconciliaria um ignorado "de verdade"
// contra a ficha do próprio admin, sem sentido nenhum.
function reconciliarIgnorados(ignorados, membros) {
  const validos = [];
  const revertidos = [];
  for (const entry of ignorados) {
    const motivoDeAssociacao = /^associado/.test(entry.motivo ?? '');
    const associadoA = entry.associadoA ?? (motivoDeAssociacao ? entry.motivo.match(/<@(\d+)>/)?.[1] : null);
    if (!associadoA) { validos.push(entry); continue; }
    const membro = membros.find(m => m.id === associadoA);
    const aindaVinculado = membro && E.idFivemDoNick(membro.nick) === String(entry.id);
    (aindaVinculado ? validos : revertidos).push(entry);
  }
  return { validos, revertidos };
}

// Associar aqui marca o ID como resolvido (ignorarId), mas isso sozinho não
// bastava: quem lê "esse membro já tem um ID vinculado" em todo o resto do
// bot (presença, sócio-sem-id, este próprio módulo na próxima atualização)
// é E.idFivemDoNick, que lê o "- 1234" do final do apelido — sem atualizar o
// apelido de verdade, o membro continuava com o ID antigo (de uma season
// anterior) no nick, e o ID novo reaparecia aqui pendente de novo assim que
// alguém revertesse o "ignorado" ou o ciclo de 20 min rodasse de novo com um
// candidato parecido. `aplicarIdNoNick` troca só o sufixo do ID, preservando
// prefixo/nome como já estão (mesma função usada em presencaInteracoes.js
// pro fluxo equivalente a partir do painel de presença). Devolve a mensagem
// de erro (string) se não conseguiu renomear (sem permissão/cargo acima do
// bot), ou null se deu certo — não é fatal pro fluxo, só some do aviso.
async function renomearComNovoId(membro, novoId) {
  const novoNick = aplicarIdNoNick(membro.nickname ?? membro.displayName, novoId);
  try {
    await membro.setNickname(novoNick);
    return null;
  } catch (err) {
    return err.message;
  }
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
  await garantirMembrosCarregados(guild);
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

  // Reconcilia antes de filtrar: um ID marcado "associado" cujo membro não
  // tem mais esse ID no apelido (revertido manualmente, ou associação que já
  // devia ter sido bloqueada — ver comentário em reconciliarIgnorados) volta
  // a ser candidato pendente sozinho, sem precisar de REATIVAR manual.
  const { validos: ignoradosValidos, revertidos } = reconciliarIgnorados(ignorados, membros);
  if (revertidos.length) {
    await gravarIgnorados(ignoradosValidos);
    console.warn('[ids-sem-socio] Reconciliação automática: vínculo desfeito, volta a pendente:', revertidos.map(r => `${r.nome ?? '?'} (${r.id})`));
  }

  const ignoradosSet = new Set(ignoradosValidos.map(r => String(r.id)));
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

// Sem a sugestão de correlação aqui — deixa a listagem enxuta e igual à
// versão sem essa inteligência; quem quer ver as associações possíveis usa
// o botão 🔎 RESOLVER PENDENTE (filtra só quem tem sugestão).
function linhaCandidato(entrada, indice) {
  const ultima = entrada.ultima ? new Date(entrada.ultima).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '?';
  // escapeMarkdown: apelido cru do jogo pode ter "**"/"||"/"`" e quebrar a
  // formatação da linha (ver mesmo fix em registrosDiarios.js/presencaInteracoes.js).
  // Número em negrito, não "1. texto" cru — mesmo fix de linhaJogador em
  // registrosDiarios.js: dígito+ponto no início da linha é lista numerada pro
  // Discord, que na borda entre a description (lista) e os fields chega a
  // desenhar 1-2 marcadores fantasmas sem conteúdo nenhum no fim da lista.
  return `**${indice + 1}.** **${escapeMarkdown(entrada.nome ?? '?')}** \`${entrada.id}\` — ${entrada.total}x · última: ${ultima}`;
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

function linhaBotoesGerenciar() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('idsemsocio:resolver').setLabel('VER PENDENTES').setEmoji('🔎').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('idsemsocio:verignorados').setLabel('VER RESOLVIDOS').setEmoji('🗂️').setStyle(ButtonStyle.Secondary)
  );
}

// Mensagem de botões vive sozinha no canal de gerenciamento (só ela, sem
// embed) — guardada à parte de CONFIG_KEY_MSGS, que é só das páginas da
// listagem.
const CONFIG_KEY_BOTOES_MSG = 'ids_sem_socio_botoes_message_id';

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

// Mesmo padrão das outras mensagens fixas com botão (VALIDAÇÃO DE ID,
// BLOQUEIO DE ID — ver commands/setup-botoes.js): embed com título e
// descrição, botões embaixo. Nada de content solto com emoji no texto.
function payloadMsgBotoes() {
  const embed = new EmbedBuilder()
    .setColor(0x000000)
    .setTitle('GERENCIAR IDS PENDENTES - GAVIÕES DA FIEL - FIVEM')
    .setDescription(
      'Clique em um dos botões abaixo:\n' +
      '**VER PENDENTES** — todo ID pendente, com sugestão automática de nome parecido primeiro.\n' +
      '**VER RESOLVIDOS** — reverter um ID já ignorado/associado.'
    );
  return { content: null, embeds: [embed], components: [linhaBotoesGerenciar()] };
}

// Garante a mensagem de botões no canal de gerenciamento, no formato padrão
// acima. Se ela já existe lá mas ainda está no formato antigo (content solto
// com emoji, de antes desse padrão), edita em posição. Se o ID salvo aponta
// pra uma mensagem que não existe MAIS nesse canal (migração: canal de
// gerenciamento acabou de ser criado, mensagem antiga ainda estava no canal
// de listagem, junto das páginas), apaga a sobra de lá antes de mandar a
// mensagem nova aqui.
async function garantirMsgBotoes(canalGerenciar, canalListagem) {
  const salvoId = await lerConfig(CONFIG_KEY_BOTOES_MSG);
  if (salvoId) {
    const salvo = await canalGerenciar.messages.fetch(salvoId).catch(() => null);
    // Sempre reedita em posição (idempotente, uma mensagem só) — não compara
    // conteúdo antigo vs. novo, então mudanças futuras no texto/botões (como
    // a adição do botão BUSCAR PENDENTE) chegam sozinhas no próximo ciclo,
    // sem precisar de outra migração manual.
    if (salvo) {
      await salvo.edit(payloadMsgBotoes());
      return salvo.id;
    }
    await canalListagem.messages.delete(salvoId).catch(() => {});
  }
  const msg = await canalGerenciar.send(payloadMsgBotoes());
  await gravarConfig(CONFIG_KEY_BOTOES_MSG, msg.id);
  return msg.id;
}

// Execução única por vez: sem isso, uma rajada de aprovações seguidas (cada
// uma agendando uma atualização reativa 30s depois) podia empilhar duas
// chamadas de atualizarIdsSemSocioImpl concorrentes — e como cada uma faz
// várias operações assíncronas (fetch de membros, N consultas de bloqueio,
// leitura/escrita de mensagens), não tem garantia de que a que começou
// DEPOIS termine DEPOIS. Se a mais lenta (ex.: pegou um retry de rate limit
// no fetch de membros) terminasse por último, ela sobrescrevia
// `ultimosCandidatos` com um resultado mais velho — foi isso que fez
// RESOLVER PENDENTE mostrar "104 com sugestão" e, minutos depois, "nenhuma
// associação possível", sem nada ter mudado de verdade nos bastidores.
// Chamada extra enquanto uma já roda não é descartada: fica marcada pra
// rodar de novo assim que a atual terminar, garantindo que o resultado final
// sempre reflita o último pedido.
let atualizacaoEmAndamento = null;
let reexecutarAoTerminar = false;

async function atualizarIdsSemSocio(client) {
  if (atualizacaoEmAndamento) {
    reexecutarAoTerminar = true;
    return atualizacaoEmAndamento;
  }
  atualizacaoEmAndamento = atualizarIdsSemSocioImpl(client).finally(async () => {
    atualizacaoEmAndamento = null;
    if (reexecutarAoTerminar) {
      reexecutarAoTerminar = false;
      await atualizarIdsSemSocio(client);
    }
  });
  return atualizacaoEmAndamento;
}

async function atualizarIdsSemSocioImpl(client) {
  const guild = await client.guilds.fetch(config.guildId);
  const canal = await garantirCanal(guild);
  const canalGerenciar = await garantirCanalGerenciar(guild, canal);
  await garantirMsgBotoes(canalGerenciar, canal);

  const candidatos = await buscarIdsSemDiscord(client, guild);
  ultimosCandidatos = candidatos;
  const embeds = montarEmbeds(candidatos);
  const idsAntigos = await lerMsgIds();

  const idsNovos = [];
  for (let i = 0; i < embeds.length; i++) {
    const payload = { embeds: [embeds[i]], allowedMentions: { parse: [] } };
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

// ── Interação: VER PENDENTES / VER IGNORADOS ────────────────────────────
// Os dois botões seguem o mesmo padrão: botão → select paginado direto, sem
// passo de busca no meio (nenhuma das duas listas costuma crescer a ponto de
// precisar de um campo de busca — e uma paginação de 25 por página já cobre
// bem). A escolha no select mostra a ficha do candidato com os botões de
// ação cabíveis (aprovar/reprovar sugestão, ignorar, reativar).

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

// TODO pendente, com sugestão de correlação por nome ou não — antes só quem
// tinha sugestão aparecia aqui (o resto não tinha jeito nenhum de ser
// associado na mão), agora a lista é completa, só ordenada pra colocar os
// casos óbvios (sugestão, mais parecido primeiro) na frente de quem precisa
// de busca manual (sem sugestão, no fim).
const POR_PAGINA_RESOLVER = 25;
function todosPendentesOrdenados() {
  return [...ultimosCandidatos].sort((a, b) => (b.sugestao?.score ?? -1) - (a.sugestao?.score ?? -1));
}

function renderizarPaginaResolver(pagina) {
  const pendentes = todosPendentesOrdenados();
  if (!pendentes.length) {
    return { content: '🎉 NENHUM ID PENDENTE NO MOMENTO — TODO ID FREQUENTE JÁ TEM ALGUÉM NO DISCORD.', components: [] };
  }
  const totalPaginas = Math.max(1, Math.ceil(pendentes.length / POR_PAGINA_RESOLVER));
  const atual = Math.min(Math.max(0, pagina), totalPaginas - 1);
  const fatia = pendentes.slice(atual * POR_PAGINA_RESOLVER, (atual + 1) * POR_PAGINA_RESOLVER);
  const selectRow = selectDeResultado('idsemsocio:selpendente', fatia,
    e => e.sugestao ? `${e.total}x · ${Math.round(e.sugestao.score * 100)}% parecido` : `${e.total}x · sem sugestão automática`);
  const temAnterior = atual > 0;
  const temProxima = atual < totalPaginas - 1;
  const botoesPag = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`idsemsocio:resolver:${atual - 1}`).setLabel('◀ ANTERIOR').setStyle(ButtonStyle.Secondary).setDisabled(!temAnterior),
    new ButtonBuilder().setCustomId(`idsemsocio:resolver:${atual + 1}`).setLabel('PRÓXIMA ▶').setStyle(ButtonStyle.Secondary).setDisabled(!temProxima)
  );
  const components = totalPaginas > 1 ? [selectRow, botoesPag] : [selectRow];
  return {
    content: `🔎 **IDS PENDENTES** (${pendentes.length}${totalPaginas > 1 ? ` · Página ${atual + 1}/${totalPaginas}` : ''}) — ESCOLHA UM PRA APROVAR, REPROVAR OU IGNORAR:`,
    components,
  };
}

// Mesmo padrão de VER PENDENTES (paginado, sem passo de busca no meio) — só
// que lendo de CONFIG_KEY_IGNORADOS em vez de `ultimosCandidatos`, por isso
// assíncrono. Antes VER IGNORADOS abria um modal pra buscar por nome/ID; sem
// necessidade real de busca (a lista não costuma ficar gigante), o mesmo
// fluxo direto de VER PENDENTES é mais simples de usar.
async function renderizarPaginaIgnorados(pagina) {
  const ignorados = await lerIgnorados();
  if (!ignorados.length) {
    return { content: '📭 NENHUM ID IGNORADO NO MOMENTO.', components: [] };
  }
  const totalPaginas = Math.max(1, Math.ceil(ignorados.length / POR_PAGINA_RESOLVER));
  const atual = Math.min(Math.max(0, pagina), totalPaginas - 1);
  const fatia = ignorados.slice(atual * POR_PAGINA_RESOLVER, (atual + 1) * POR_PAGINA_RESOLVER);
  const selectRow = selectDeResultado('idsemsocio:selignorado', fatia, e => e.motivo ?? 'ignorado');
  const temAnterior = atual > 0;
  const temProxima = atual < totalPaginas - 1;
  const botoesPag = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`idsemsocio:verignorados:${atual - 1}`).setLabel('◀ ANTERIOR').setStyle(ButtonStyle.Secondary).setDisabled(!temAnterior),
    new ButtonBuilder().setCustomId(`idsemsocio:verignorados:${atual + 1}`).setLabel('PRÓXIMA ▶').setStyle(ButtonStyle.Secondary).setDisabled(!temProxima)
  );
  const components = totalPaginas > 1 ? [selectRow, botoesPag] : [selectRow];
  return {
    content: `🗂️ **IDS IGNORADOS** (${ignorados.length}${totalPaginas > 1 ? ` · Página ${atual + 1}/${totalPaginas}` : ''}) — ESCOLHA UM PRA VER DETALHES OU REATIVAR:`,
    components,
  };
}

// `membroSugestao` é o GuildMember já resolvido da sugestão (busca feita no
// handler, que tem acesso à guild) — usado pra mostrar o avatar dele como
// thumbnail, além da menção normal.
function embedFichaPendente(c, membroSugestao) {
  const ultima = c.ultima ? new Date(c.ultima).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '?';
  const linhas = [
    `**ID:** \`${c.id}\``,
    `**Interações nos logs:** ${c.total}x`,
    `**Última aparição:** ${ultima}`,
  ];
  if (c.sugestao) linhas.push(`**Possível correlação:** <@${c.sugestao.discordId}> (${Math.round(c.sugestao.score * 100)}% de nome parecido)`);
  linhas.push(`\nNão é essa a pessoa, ou quer indicar outra? Busque e selecione direto no campo abaixo.`);
  const embed = { color: 0x000000, title: `🔗 ${c.nome ?? '?'}`, description: linhas.join('\n') };
  if (membroSugestao) embed.thumbnail = { url: membroSugestao.displayAvatarURL({ extension: 'png', size: 128 }) };
  return embed;
}

// Botões da sugestão automática (linha 1) + select nativo de membro do
// Discord (linha 2), que já vem com busca reativa por nome em todo o
// servidor (mesmo componente usado em presencaInteracoes.js) — cobre tanto
// confirmar a sugestão calculada quanto corrigi-la escolhendo outra pessoa
// na mão, sem depender só do algoritmo de nome parecido.
function botoesPendente(c) {
  const botoes = [];
  if (c.sugestao) {
    botoes.push(
      new ButtonBuilder().setCustomId(`idsemsocio:confirmar:${c.id}:${c.sugestao.discordId}`).setLabel('É ELE — ASSOCIAR AO USUÁRIO').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`idsemsocio:rejeitarsugestao:${c.id}:${c.sugestao.discordId}`).setLabel('NÃO É ELE').setEmoji('❌').setStyle(ButtonStyle.Secondary)
    );
  }
  botoes.push(new ButtonBuilder().setCustomId(`idsemsocio:ignorar:${c.id}`).setLabel('IGNORAR (SEM CORRELAÇÃO)').setEmoji('🚫').setStyle(ButtonStyle.Danger));
  const linhaBotoes = new ActionRowBuilder().addComponents(botoes);
  const selectMembro = new UserSelectMenuBuilder()
    .setCustomId(`idsemsocio:selecionarmembro:${c.id}`)
    .setPlaceholder('🔎 BUSCAR E VINCULAR OUTRO MEMBRO');
  const linhaSelect = new ActionRowBuilder().addComponents(selectMembro);
  return [linhaBotoes, linhaSelect];
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
    const resposta = renderizarPaginaResolver(Number(a) || 0);
    // Primeiro clique (sem página no customId) é reply novo; clique de
    // paginação (ANTERIOR/PRÓXIMA) edita a mesma mensagem ephemeral.
    return a == null ? interaction.reply({ ...resposta, flags: 64 }) : interaction.update(resposta);
  }

  if (interaction.isButton() && acao === 'verignorados') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const resposta = await renderizarPaginaIgnorados(Number(a) || 0);
    // Mesma lógica do RESOLVER/VER PENDENTES: primeiro clique é reply novo,
    // paginação edita a mesma mensagem ephemeral.
    return a == null ? interaction.reply({ ...resposta, flags: 64 }) : interaction.update(resposta);
  }

  if (interaction.isStringSelectMenu() && acao === 'selpendente') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const c = ultimosCandidatos.find(e => String(e.id) === interaction.values[0]);
    if (!c) return interaction.reply({ content: '❌ ESSE ID NÃO ESTÁ MAIS PENDENTE (A LISTA JÁ ATUALIZOU).', flags: 64 });
    const membroSugestao = c.sugestao ? await interaction.guild.members.fetch(c.sugestao.discordId).catch(() => null) : null;
    return interaction.reply({ embeds: [embedFichaPendente(c, membroSugestao)], components: botoesPendente(c), flags: 64, allowedMentions: { parse: [] } });
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
    const membro = await interaction.guild.members.fetch(b).catch(() => null);
    if (!membro) return interaction.reply({ content: '❌ ESSE MEMBRO NÃO ESTÁ MAIS NO SERVIDOR.', flags: 64 });
    const erroRename = await renomearComNovoId(membro, c.id);
    // Só marca como resolvido se o apelido realmente mudou — se o rename
    // falhou (sem permissão/cargo acima do bot), marcar ignorarId aqui
    // escondia o ID pra sempre em `ids_sem_socio_ignorados` como "associado"
    // sem o vínculo ter sido criado de verdade (era exatamente esse o bug do
    // Cris Sabará: ficava em VER IGNORADOS, sumia da lista de pendentes, mas
    // o apelido nunca tinha o ID). Sem chamar ignorarId, o candidato continua
    // pendente e pode ser tentado de novo assim que a permissão for corrigida.
    if (!erroRename) {
      await ignorarId(c, `associado a <@${b}> (season anterior)`, interaction.user.id, b);
      agendarAtualizacaoReativa(interaction.client);
      return interaction.reply({ content: `ID \`${a}\` ASSOCIADO A <@${b}> — SAI DA LISTA.`, flags: 64, allowedMentions: { parse: [] } });
    }
    return interaction.reply({
      content: `❌ APELIDO NÃO ATUALIZADO (SEM PERMISSÃO OU CARGO ACIMA DO BOT): ${erroRename}\nID \`${a}\` CONTINUA PENDENTE — CORRIJA A PERMISSÃO E TENTE DE NOVO.`,
      flags: 64,
      allowedMentions: { parse: [] },
    });
  }

  // Correção manual: a liderança busca e escolhe direto no select nativo do
  // Discord (filtra reativamente por nome em todo o servidor, igual o
  // "BUSCAR JOGADOR" do painel de presença) em vez de depender só do
  // palpite automático — cobre tanto confirmar com outra pessoa quanto o
  // caso de não ter vindo sugestão nenhuma.
  if (interaction.isUserSelectMenu() && acao === 'selecionarmembro') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const c = ultimosCandidatos.find(e => String(e.id) === a);
    if (!c) return interaction.reply({ content: '❌ ESSE ID NÃO ESTÁ MAIS PENDENTE (A LISTA JÁ ATUALIZOU).', flags: 64 });
    const membro = interaction.members.first();
    if (!membro) return interaction.reply({ content: '❌ MEMBRO NÃO ENCONTRADO.', flags: 64 });
    const erroRename = await renomearComNovoId(membro, c.id);
    // Mesmo motivo do fluxo CONFIRMAR acima: só marca resolvido se o apelido
    // mudou de verdade.
    if (!erroRename) {
      await ignorarId(c, `associado manualmente a ${membro} por <@${interaction.user.id}>`, interaction.user.id, membro.id);
      agendarAtualizacaoReativa(interaction.client);
      return interaction.reply({ content: `ID \`${a}\` ASSOCIADO A ${membro} — SAI DA LISTA.`, flags: 64, allowedMentions: { parse: [] } });
    }
    return interaction.reply({
      content: `❌ APELIDO NÃO ATUALIZADO (SEM PERMISSÃO OU CARGO ACIMA DO BOT): ${erroRename}\nID \`${a}\` CONTINUA PENDENTE — CORRIJA A PERMISSÃO E TENTE DE NOVO.`,
      flags: 64,
      allowedMentions: { parse: [] },
    });
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
    return interaction.reply({ content: `🚫 ID \`${a}\` IGNORADO — SAI DA LISTA (USE VER RESOLVIDOS PRA REVERTER).`, flags: 64 });
  }

  if (interaction.isButton() && acao === 'reativar') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await reativarId(a);
    agendarAtualizacaoReativa(interaction.client);
    return interaction.reply({ content: `↩️ ID \`${a}\` REATIVADO — VOLTA A APARECER NA LISTA SE AINDA ESTIVER PENDENTE.`, flags: 64 });
  }
});

module.exports = { iniciarIdsSemSocio, agendarAtualizacaoReativa, atualizarIdsSemSocio };
