const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
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
const LIMITE_EMBED = 5500; // margem abaixo do limite de 6000 do Discord (título+descrição+campos)
const LIMITE_CAMPO = 1000; // margem abaixo do limite de 1024 por campo

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

function linhaJogador(entrada, indice) {
  return `${indice + 1}. **${entrada.nome ?? '?'}** \`${entrada.id}\` — ${E.formatarDuracao(entrada.ms)}`;
}

// Quebra uma lista de linhas em grupos que caibam num campo de embed
// (LIMITE_CAMPO cada) — mesma ideia do `content` paginado do canal de
// sócios sem ID, só que por campo em vez de por mensagem inteira.
function agruparLinhas(linhas, limite) {
  const grupos = [];
  let atual = [];
  let tamanho = 0;
  for (const linha of linhas) {
    const acrescimo = linha.length + 1;
    if (atual.length && tamanho + acrescimo > limite) {
      grupos.push(atual);
      atual = [];
      tamanho = 0;
    }
    atual.push(linha);
    tamanho += acrescimo;
  }
  if (atual.length) grupos.push(atual);
  return grupos;
}

// Um dia normalmente cabe num embed só (resumo + lista de jogadores). Se a
// lista for grande demais pro limite de 6000 caracteres do Discord, quebra
// em mais de um embed — cada um vira uma mensagem separada no canal,
// mantendo a ordem (resumo só no primeiro).
function montarEmbedsRegistro(dia, dados) {
  const linhas = dados.entradas.map((e, i) => linhaJogador(e, i));
  const gruposLinhas = agruparLinhas(linhas, LIMITE_CAMPO);
  // É UMA lista só (só quebrada em campos porque cada campo do Discord tem
  // limite de 1024 caracteres) — repetir "JOGADORES" com numeração de parte
  // a cada pedaço dava a impressão de várias listas soltas. Nome só no
  // primeiro campo; os campos seguintes usam um espaço de largura zero como
  // nome (Discord não aceita campo sem nome) pra não repetir nada e a lista
  // continuar direto, como se fosse um texto só.
  const camposLista = gruposLinhas.map((grupo, i) => ({
    name: i === 0 ? `JOGADORES (${dados.entradas.length})` : '​',
    value: grupo.join('\n'),
    inline: false,
  }));

  const paginas = [];
  let atual = { primeira: true, fields: [dados.resumo], tamanho: dados.resumo.name.length + dados.resumo.value.length };
  for (const campo of camposLista) {
    const custo = campo.name.length + campo.value.length;
    if (atual.fields.length >= 24 || atual.tamanho + custo > LIMITE_EMBED) {
      paginas.push(atual);
      atual = { primeira: false, fields: [], tamanho: 0 };
    }
    atual.fields.push(campo);
    atual.tamanho += custo;
  }
  paginas.push(atual);

  return paginas.map((p, i) => ({
    color: 0x000000,
    title: p.primeira ? `📅 REGISTRO DIÁRIO — ${tituloDia(dia)}` : null,
    description: p.primeira ? dados.linhaTopo : `*(continuação — ${tituloDia(dia)})*`,
    fields: p.fields,
    footer: {
      text: `Com base nos logs do jogo recebidos pelo webhook · canal logs-painel`
        + (paginas.length > 1 ? ` · Página ${i + 1}/${paginas.length}` : ''),
    },
    timestamp: new Date().toISOString(),
  }));
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

module.exports = { iniciarRegistrosDiarios, atualizarRegistrosDiarios, agendarAtualizacaoReativa };
