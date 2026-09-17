const { ChannelType, PermissionFlagsBits: P, escapeMarkdown } = require('discord.js');
const config = require('../../config/index.js');
const { lerConfig, gravarConfig } = require('../botConfig');
const E = require('./estatisticas');
const repo = require('./repositorio');
const relatorios = require('./relatorios');
const { botaoVerJogadores } = require('./registrosDiariosInteracoes');

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
// Usada só na exploração ephemeral (ver registrosDiariosInteracoes.js) — a
// lista de jogadores não mora mais na mensagem do canal, ver montarEmbedRegistro.
function linhaJogador(entrada, indice) {
  const nome = escapeMarkdown(entrada.nome ?? '?');
  const id = escapeMarkdown(String(entrada.id));
  return `**${indice + 1}.** **${nome}** \`${id}\` — ${E.formatarDuracao(entrada.ms)}`;
}

// A mensagem do canal é só o resumo do dia (curto, sempre cabe folgado nos
// limites do Discord) + um botão que abre a lista de jogadores paginada,
// ephemeral (ver registrosDiariosInteracoes.js). Antes a lista inteira (até
// ~200 nomes em negrito) vivia direto na description, quebrada em várias
// mensagens quando passava de 4096 caracteres — o texto gravado no Discord
// sempre saía completo (auditado direto pela API), mas o CLIENTE do Discord
// ocasionalmente "comia" o fim de alguma linha na tela do usuário, sempre em
// posição diferente e sem relação com o dado (bug relatado com print pelo
// usuário em 2026-09-15/17, em posições diferentes a cada vez — 99/100, depois
// 66, depois de novo em posições variadas mesmo após números virarem negrito).
// Sem controle sobre esse bug do lado do Discord, a saída é não depender de
// blocos gigantes de markdown: cada página ephemeral tem no máximo 25 nomes,
// mesmo padrão já usado sem problema no painel de presença ao vivo.
function montarEmbedRegistro(dia, dados) {
  return {
    color: 0x000000,
    title: `📅 REGISTRO DIÁRIO — ${tituloDia(dia)}`,
    description: dados.linhaTopo,
    fields: [dados.resumo],
    footer: { text: 'Com base nos logs do jogo recebidos pelo webhook · canal logs-painel' },
    timestamp: new Date().toISOString(),
  };
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

// Monta/edita a mensagem de um dia e devolve o ID final — reaproveita a
// mensagem antiga se ainda existir, cria uma nova senão. `idsAntigos` pode
// trazer mais de um ID de acervo anterior (de quando o dia ainda virava
// vários embeds paginados na description, ver comentário de montarEmbedRegistro)
// — o excesso é apagado aqui, colapsando o dia numa mensagem só sem duplicar
// nem perder histórico (o dado real vem de novo dos logs, nunca das mensagens
// antigas).
async function atualizarRegistroDoDia(canal, dia, periodo, agora, idsAntigos = []) {
  // listaCumulativa: um registro arquivado é sempre "quem jogou no dia",
  // ranking por tempo — nunca "quem está online agora" (que é o que o
  // período 'hoje' passaria a mostrar por padrão, pensado pro botão AGORA
  // do painel ao vivo, não pra um acervo).
  // semContextoGlobal: cabeçalho do registro é sobre O DIA — tira o "maior
  // bonde já registrado" (recorde de todo o histórico), que só confundia ao
  // lado do "pico de simultâneos" do próprio dia, logo abaixo.
  const dados = await relatorios.montarDadosPresenca(periodo, { listaCumulativa: true, semContextoGlobal: true }, agora);
  const embed = montarEmbedRegistro(dia, dados);
  const payload = { embeds: [embed], components: [botaoVerJogadores(dia)], allowedMentions: { parse: [] } };

  const [idPrincipal, ...idsExtras] = idsAntigos;
  if (idPrincipal) {
    const msg = await canal.messages.fetch(idPrincipal).catch(() => null);
    if (msg) {
      await comRetry(() => msg.edit(payload));
      for (const idExtra of idsExtras) await canal.messages.delete(idExtra).catch(() => {});
      return [idPrincipal];
    }
  }
  const nova = await comRetry(() => canal.send(payload));
  for (const idExtra of idsExtras) await canal.messages.delete(idExtra).catch(() => {});
  return [nova.id];
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
// de um ajuste visual em montarEmbedRegistro/linhasContexto; não é chamado
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

// Apaga toda mensagem do canal, mais antiga que 14 dias ou não — bulkDelete
// já filtra sozinho (`filterOld: true`) e devolve só o que conseguiu apagar
// em lote; o resto (mensagens mais antigas, que a API não deixa apagar em
// lote) cai pro delete individual, um a um.
async function apagarTodasMensagens(canal) {
  let apagadas = 0;
  for (;;) {
    const lote = await canal.messages.fetch({ limit: 100 });
    if (!lote.size) break;
    const apagadasEmLote = await comRetry(() => canal.bulkDelete(lote, true));
    apagadas += apagadasEmLote.size;
    const restantes = lote.filter(m => !apagadasEmLote.has(m.id));
    for (const msg of restantes.values()) {
      await comRetry(() => msg.delete());
      apagadas++;
    }
  }
  return apagadas;
}

// Todo dia (chave "YYYY-MM-DD") entre `primeiraData` (inclusive) e
// `diaLimiteExclusivo` (exclusive) — os dias já fechados que o acervo
// completo precisa cobrir, do primeiro log de entrada/saída registrado até
// ontem (hoje é tratado separado, como dia em andamento).
function listaDiasAntes(diaLimiteExclusivo, primeiraData) {
  const dias = [];
  let cursor = E.inicioDoDiaSP(primeiraData);
  const limite = new Date(`${diaLimiteExclusivo}T00:00:00-03:00`);
  while (cursor < limite) {
    dias.push(E.chaveDia(cursor));
    cursor = new Date(cursor.getTime() + E.DIA_MS);
  }
  return dias;
}

// Reconstrução completa: apaga TUDO que já foi publicado no canal e recria
// do zero, dia após dia em ordem cronológica, desde o primeiro dia com log
// de entrada/saída registrado até hoje — pedido do usuário em 2026-09-17.
// Diferente de reprocessarFormatacaoDiasFechados (que só reedita mensagens
// que já existem, dia a dia do estado salvo): aqui `estado` é zerado e todo
// dia sai como mensagem NOVA (send em sequência, nunca edit), o que garante
// a ordem cronológica no canal mesmo pra dias que nunca tiveram registro
// (ex.: histórico anterior a este canal existir, ou um dia que o bot ficou
// fora do ar e pulou — ver o comentário no topo do arquivo sobre lacunas).
// Só leitura no banco (montarDadosPresenca, mesma fonte de sempre); o "dado
// real" nunca vem das mensagens antigas, por isso apagar tudo antes é seguro.
async function reconstruirAcervoCompleto(client) {
  const guild = await client.guilds.fetch(config.guildId);
  const canal = await garantirCanal(guild);
  const agora = new Date();

  const apagadas = await apagarTodasMensagens(canal);

  const primeira = await repo.primeiroEventoConexao();
  const diaHoje = E.chaveDia(agora);
  const dias = primeira ? listaDiasAntes(diaHoje, primeira) : [];

  const estado = {};
  for (const dia of dias) {
    const ids = await atualizarRegistroDoDia(canal, dia, periodoDoDia(dia), agora, []);
    estado[dia] = { messageIds: ids, finalizado: true };
  }

  const periodoHoje = E.resolverPeriodo('hoje', agora);
  const idsHoje = await atualizarRegistroDoDia(canal, diaHoje, periodoHoje, agora, []);
  estado[diaHoje] = { messageIds: idsHoje, finalizado: false };

  await gravarEstado(estado);
  return { apagadas, criados: dias.length + 1 };
}

// Fila de execução única: o ciclo por tempo, o reativo (debounce) e o
// reprocessamento manual (/registros-diarios-reformatar) chamam a mesma
// mensagem do canal. Sem isso, uma atualização lenta (editar várias mensagens
// com retry de rate limit do Discord pode levar vários segundos) e um evento
// novo chegando no meio dela liberavam DUAS execuções em paralelo — cada uma
// calculando o total de jogadores a partir de um instante diferente, e se a
// mais lenta (com MENOS jogadores contados) terminasse por último, ela
// sobrescrevia a mensagem com um número menor que o já publicado. Sintoma
// relatado pelo usuário em 2026-09-15: o registro de hoje "travando" ora em
// 66, ora em 59 — cada corrida vencedora dependia do timing de quem
// entrava/saía naquele instante. Serializar garante que a próxima atualização
// só começa depois que a anterior termina de verdade (edições já confirmadas
// no Discord), nunca duas ao mesmo tempo.
let filaAtual = Promise.resolve();
function serializado(fn) {
  const execucao = filaAtual.then(fn, fn);
  filaAtual = execucao.catch(() => {}); // uma falha não trava as próximas da fila
  return execucao;
}

function iniciarRegistrosDiarios(client) {
  const atualizar = () => serializado(() => atualizarRegistrosDiarios(client))
    .catch(err => console.error('[registros-diarios] Erro ao atualizar:', err));
  atualizar();
  // O ciclo por tempo fica só como rede de segurança (mesmo padrão do painel
  // de jogadores — ver painelJogadores.js): a atualização de verdade é
  // reativa, disparada a cada entrada/saída que chega.
  setInterval(atualizar, INTERVALO_HORAS * 60 * 60 * 1000);
}

// Atualização reativa: dispara pouco depois de um evento de entrada/saída
// chegar, em vez de esperar o próximo ciclo de tempo. Debounce maior que o
// do painel de jogadores (15s) porque uma rajada de entradas/saídas seguidas
// numa única atualização evita martelar a edição da mensagem repetidas
// vezes em poucos segundos.
const DEBOUNCE_MS = 45 * 1000;
let timerPendente = null;

function agendarAtualizacaoReativa(client) {
  if (timerPendente) return;
  timerPendente = setTimeout(() => {
    timerPendente = null;
    serializado(() => atualizarRegistrosDiarios(client))
      .catch(err => console.error('[registros-diarios] Erro ao atualizar (reativo):', err));
  }, DEBOUNCE_MS);
}

module.exports = {
  iniciarRegistrosDiarios,
  atualizarRegistrosDiarios,
  agendarAtualizacaoReativa,
  // Na mesma fila do ciclo reativo/por tempo: sem isso, rodar o comando
  // enquanto uma atualização reativa está no meio de editar as mesmas
  // mensagens (ex.: reformatar "ontem" bem na hora em que o ciclo normal
  // fecha "ontem" de verdade) cria a mesma corrida descrita acima.
  reprocessarFormatacaoDiasFechados: client => serializado(() => reprocessarFormatacaoDiasFechados(client)),
  // Mesma fila, mesmo motivo — reconstrução completa (/registros-diarios-reconstruir)
  // apaga e recria toda mensagem do canal, não pode correr ao lado de uma
  // atualização reativa/por tempo tocando nas mesmas mensagens.
  reconstruirAcervoCompleto: client => serializado(() => reconstruirAcervoCompleto(client)),
  // As três abaixo existem só pra registrosDiariosInteracoes.js montar a
  // lista de jogadores sob demanda, quando alguém clica no botão da mensagem
  // (ver ali) — require em cima causaria dependência circular, por isso lá o
  // require desses três é local à função, não no topo do arquivo.
  periodoDoDia,
  tituloDia,
  linhaJogador,
};
