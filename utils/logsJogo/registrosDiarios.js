const { ChannelType, PermissionFlagsBits: P, escapeMarkdown } = require('discord.js');
const config = require('../../config/index.js');
const { lerConfig, gravarConfig } = require('../botConfig');
const E = require('./estatisticas');
const relatorios = require('./relatorios');

// Canal-acervo: um registro por dia (pico de simultâneos, jogadores
// distintos e o tempo de cada um), reaproveitando a mesma inteligência do
// painel de jogadores (relatorios.montarDadosPresenca) — só que arquivado,
// não ao vivo. O dia em andamento é reeditado a cada ciclo; o dia anterior é
// atualizado uma última vez com os dados fechados e nunca mais tocado
// (`finalizado: true`), virando um registro fixo dali pra frente.
//
// Reinício do bot que pule dias inteiros sem rodar não preenche o buraco —
// só "ontem" é fechado a cada ciclo, dias mais antigos que ficaram sem
// fechamento não são recalculados (mesma filosofia do painel de jogadores:
// estado recalculável, sem custo de perder um ciclo, mas aqui um dia
// inteiro perdido fica mesmo como lacuna no acervo).
const CONFIG_KEY_CANAL = 'canal_registros_diarios';
const CONFIG_KEY_ESTADO = 'registros_diarios_estado';
const NOME_CANAL = '📅・registros-diarios';
const INTERVALO_HORAS = 6;
const LIMITE_DESCRICAO = 3900; // margem abaixo do limite de 4096 caracteres da description do Discord

function permissoesCanal(guild, botId) {
  return [
    { id: guild.roles.everyone.id, allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages] },
    ...config.lideranca.map(id => ({ id, allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.EmbedLinks] })),
    { id: botId, allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.EmbedLinks, P.ManageMessages] },
  ];
}

// Reaproveita o canal já criado (ID salvo em bot_config); cria na mesma
// categoria do painel de jogadores só na primeira vez, igual ao canal de
// sócios sem ID.
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
    reason: 'Acervo diário de presença de jogadores',
  });
  await gravarConfig(CONFIG_KEY_CANAL, canal.id);
  return canal;
}

async function lerEstado() {
  try {
    const bruto = await lerConfig(CONFIG_KEY_ESTADO);
    return bruto ? JSON.parse(bruto) : {};
  } catch (err) {
    console.error('[registros-diarios] Erro ao ler estado:', err);
    return {};
  }
}

async function gravarEstado(estado) {
  await gravarConfig(CONFIG_KEY_ESTADO, JSON.stringify(estado));
}

function tituloDia(dia) {
  const [ano, mes, d] = dia.split('-');
  return `${d}/${mes}/${ano}`;
}

// escapeMarkdown no nome: apelido vem cru do jogo (webhook), sem passar por
// nenhuma sanitização — um nome com "**", "||" ou "`" quebra a formatação da
// linha (ex.: "||" sem par vira spoiler que engole o resto da lista até achar
// outro "||" nome abaixo, sumindo com posições inteiras, sem erro nenhum pro
// log). `entrada.id` também escapado por segurança, mesmo sendo numérico hoje.
function linhaJogador(entrada, indice) {
  const nome = escapeMarkdown(entrada.nome ?? '?');
  const id = escapeMarkdown(String(entrada.id));
  return `${indice + 1}. **${nome}** \`${id}\` — ${E.formatarDuracao(entrada.ms)}`;
}

// Quebra uma lista de linhas em pedaços que caibam num orçamento de
// caracteres cada — o primeiro pedaço tem orçamento menor (sobra menos
// espaço, porque a description da primeira mensagem também carrega
// linhaTopo + o cabeçalho "JOGADORES (N)"), os seguintes usam o orçamento
// cheio. Usado pra montar a description de cada mensagem, nunca `fields`:
// um field do Discord sempre reserva uma linha de nome, mesmo com nome
// vazio — isso abria um respiro estranho no meio da lista numerada (ver
// print do usuário, posição 26→27 e 51→52). Texto corrido na description
// não tem essa quebra.
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
  grupos.push(atual); // sempre pelo menos um grupo, mesmo vazio (dia sem ninguém online)
  return grupos;
}

// Um dia normalmente cabe numa mensagem só (resumo + lista de jogadores
// inteira na description). Se a lista for grande demais pro limite de 4096
// caracteres da description, quebra em mais de uma mensagem — cada uma
// continua a mesma coluna vertical, sem repetir cabeçalho no meio.
function montarEmbedsRegistro(dia, dados) {
  const linhas = dados.entradas.map((e, i) => linhaJogador(e, i));
  const cabecalhoLista = `**JOGADORES (${dados.entradas.length})**\n`;
  const cabecalhoPrimeira = `${dados.linhaTopo}\n\n${cabecalhoLista}`;
  const orcamentoPrimeira = Math.max(500, LIMITE_DESCRICAO - cabecalhoPrimeira.length);
  const grupos = dados.entradas.length
    ? agruparPorOrcamento(linhas, orcamentoPrimeira, LIMITE_DESCRICAO)
    : [[]];

  return grupos.map((grupo, i) => ({
    color: 0x000000,
    title: i === 0 ? `📅 REGISTRO DIÁRIO — ${tituloDia(dia)}` : null,
    description: i === 0
      ? `${cabecalhoPrimeira}${grupo.join('\n') || '*Ninguém online registrado.*'}`
      : `*(continuação — ${tituloDia(dia)})*\n\n${grupo.join('\n')}`,
    fields: i === 0 ? [dados.resumo] : [],
    footer: {
      text: `Com base nos logs do jogo recebidos pelo webhook · canal logs-painel`
        + (grupos.length > 1 ? ` · Página ${i + 1}/${grupos.length}` : ''),
    },
    timestamp: new Date().toISOString(),
  }));
}

// Reexecuta `fn` se o Discord recusar por rate limit (mesma lógica de
// membrosGuild.js: `retry_after` diz exatamente quanto esperar). Sem isso, um
// 429 no meio do loop de mensagens abaixo derrubava a função inteira — a
// página que já tinha sido editada ficava com o cabeçalho novo, mas as
// páginas seguintes travavam no conteúdo antigo (números batendo, lista
// desatualizada), porque a exceção também impedia o dia de ser marcado
// `finalizado` (e por isso nunca mais era reprocessado sozinho).
async function comRetry(fn, tentativasRestantes = 2) {
  try {
    return await fn();
  } catch (err) {
    const retryAfter = err?.data?.retry_after ?? err?.retryAfter;
    if (tentativasRestantes > 0 && typeof retryAfter === 'number') {
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000 + 500));
      return comRetry(fn, tentativasRestantes - 1);
    }
    throw err;
  }
}

// Monta/edita as mensagens de um dia (uma ou várias, se a lista de
// jogadores precisar de mais de um embed) e devolve os IDs finais — reaproveita
// as mensagens antigas por posição, cria as que faltarem e apaga o excesso
// (lista encolheu, o que não deveria acontecer, mas fecha o ciclo).
async function atualizarRegistroDoDia(canal, dia, periodo, agora, idsAntigos = []) {
  // listaCumulativa: um registro arquivado é sempre "quem jogou no dia",
  // ranking por tempo — nunca "quem está online agora" (que é o que o
  // período 'hoje' passaria a mostrar por padrão, pensado pro botão AGORA
  // do painel ao vivo, não pra um acervo).
  // semContextoGlobal: cabeçalho do registro é sobre O DIA — tira o "maior
  // bonde já registrado" (recorde de todo o histórico), que só confundia ao
  // lado do "pico de simultâneos" do próprio dia, logo abaixo.
  const dados = await relatorios.montarDadosPresenca(periodo, { listaCumulativa: true, semContextoGlobal: true }, agora);
  const embeds = montarEmbedsRegistro(dia, dados);
  const idsNovos = [];

  for (let i = 0; i < embeds.length; i++) {
    const idAntigo = idsAntigos[i];
    if (idAntigo) {
      const msg = await canal.messages.fetch(idAntigo).catch(() => null);
      if (msg) {
        await comRetry(() => msg.edit({ embeds: [embeds[i]], allowedMentions: { parse: [] } }));
        idsNovos.push(idAntigo);
        continue;
      }
    }
    const nova = await comRetry(() => canal.send({ embeds: [embeds[i]], allowedMentions: { parse: [] } }));
    idsNovos.push(nova.id);
  }
  for (const idExtra of idsAntigos.slice(embeds.length)) {
    await canal.messages.delete(idExtra).catch(() => {});
  }
  return idsNovos;
}

async function atualizarRegistrosDiarios(client) {
  const guild = await client.guilds.fetch(config.guildId);
  const canal = await garantirCanal(guild);
  const estado = await lerEstado();
  const agora = new Date();

  // Fecha "ontem" com os dados definitivos (só uma vez — depois de
  // `finalizado: true` esse dia nunca é recalculado de novo).
  const periodoOntem = E.resolverPeriodo('ontem', agora);
  const diaOntem = E.chaveDia(periodoOntem.inicio);
  if (!estado[diaOntem]?.finalizado) {
    const idsOntem = await atualizarRegistroDoDia(canal, diaOntem, periodoOntem, agora, estado[diaOntem]?.messageIds);
    estado[diaOntem] = { messageIds: idsOntem, finalizado: true };
  }

  // Reedita o dia em andamento (números sobem até a virada do dia).
  const periodoHoje = E.resolverPeriodo('hoje', agora);
  const diaHoje = E.chaveDia(agora);
  const idsHoje = await atualizarRegistroDoDia(canal, diaHoje, periodoHoje, agora, estado[diaHoje]?.messageIds);
  estado[diaHoje] = { messageIds: idsHoje, finalizado: false };

  await gravarEstado(estado);
}

// Reconstrói o período de UM dia já fechado (chave "YYYY-MM-DD"), fora do
// ciclo normal (que só sabe falar de "ontem"/"hoje"). `chave: 'ontem'` é só
// pra herdar a granularidade por hora do sparkline — os campos que
// realmente importam pra montarDadosPresenca são inicio/fim.
function periodoDoDia(dia) {
  const inicio = new Date(`${dia}T00:00:00-03:00`);
  return { chave: 'ontem', rotulo: tituloDia(dia), inicio, fim: new Date(inicio.getTime() + E.DIA_MS) };
}

// Reprocessamento único: reedita a FORMATAÇÃO de dias já `finalizado: true`
// (rótulo, numeração das listas etc.) sem recalcular nada que mudaria o
// resultado — um dia fechado não recebe log novo, então os números saem
// idênticos, só a apresentação muda. Existe só pra corrigir o acervo depois
// de um ajuste visual em montarEmbedsRegistro/linhasContexto; não é chamado
// no ciclo normal (ver atualizarRegistrosDiarios, que só reprocessa "ontem"
// e "hoje"). Devolve quantos dias foram reeditados.
async function reprocessarFormatacaoDiasFechados(client) {
  const guild = await client.guilds.fetch(config.guildId);
  const canal = await garantirCanal(guild);
  const estado = await lerEstado();
  const agora = new Date();

  let reeditados = 0;
  for (const dia of Object.keys(estado)) {
    if (!estado[dia]?.finalizado) continue;
    const idsNovos = await atualizarRegistroDoDia(canal, dia, periodoDoDia(dia), agora, estado[dia].messageIds);
    estado[dia] = { messageIds: idsNovos, finalizado: true };
    reeditados++;
  }
  await gravarEstado(estado);
  return reeditados;
}

function iniciarRegistrosDiarios(client) {
  const atualizar = () => atualizarRegistrosDiarios(client).catch(err => console.error('[registros-diarios] Erro ao atualizar:', err));
  atualizar();
  // O ciclo por tempo fica só como rede de segurança (mesmo padrão do painel
  // de jogadores — ver painelJogadores.js): a atualização de verdade é
  // reativa, disparada a cada entrada/saída que chega.
  setInterval(atualizar, INTERVALO_HORAS * 60 * 60 * 1000);
}

// Atualização reativa: dispara pouco depois de um evento de entrada/saída
// chegar, em vez de esperar o próximo ciclo de tempo. Debounce maior que o
// do painel de jogadores (15s) porque aqui uma atualização pode editar até
// 6 mensagens (lista grande quebrada em campos) — juntar uma rajada de
// entradas/saídas seguidas numa única atualização evita martelar a edição
// de várias mensagens repetidas vezes em poucos segundos.
const DEBOUNCE_MS = 45 * 1000;
let timerPendente = null;

function agendarAtualizacaoReativa(client) {
  if (timerPendente) return;
  timerPendente = setTimeout(() => {
    timerPendente = null;
    atualizarRegistrosDiarios(client).catch(err => console.error('[registros-diarios] Erro ao atualizar (reativo):', err));
  }, DEBOUNCE_MS);
}

module.exports = {
  iniciarRegistrosDiarios,
  atualizarRegistrosDiarios,
  agendarAtualizacaoReativa,
  reprocessarFormatacaoDiasFechados,
};
