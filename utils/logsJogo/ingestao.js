const { SnowflakeUtil } = require('discord.js');
const config = require('../../config/index.js');
const { parseRegistro } = require('./parser');
const repo = require('./repositorio');

// Os logs continuam no canal do webhook; aqui eles só são lidos e gravados.

function ehMensagemDeLog(message) {
  return config.logsJogo.canais.includes(message.channelId)
    && Boolean(message.webhookId || message.author?.bot)
    && message.embeds?.length > 0;
}

function registrosDaMensagem(message) {
  return message.embeds.map((embed, indice) => {
    const dados = embed.data ?? embed;
    return {
      messageId: message.id,
      embedIndice: indice,
      canalId: message.channelId,
      ...parseRegistro(dados),
      // A hora em que o webhook publicou é a hora do evento no jogo
      ocorridoEm: message.createdAt,
      bruto: { ...dados, autor: message.author?.username ?? null, webhookId: message.webhookId ?? null },
    };
  });
}

// "#15277 Fulano recrutou #19465 Beltrano." prova que o recrutado JÁ ESTÁ no
// servidor agora — mas o "entrou no servidor" dele (canal logs-painel) pode
// ter se perdido, mesma perda de pacote documentada em presenca.js. Sem
// isso, ele fica de fora da presença até o jogo mandar uma saída, o que
// nunca acontece pra quem nunca foi marcado online (pedido do usuário,
// 2026-09-15: recrutados do dia não apareciam como online mesmo estando).
// messageId sintético via SnowflakeUtil: precisa ser um número (comparações
// `message_id::bigint` em toda consulta de conexão, ver estadoDosJogadores),
// só não pode colidir com o message_id real do próprio log de recrutamento —
// daí não reaproveitar o mesmo id.
function montarEntradaImplicita(registro) {
  return {
    messageId: SnowflakeUtil.generate({ timestamp: registro.ocorridoEm }).toString(),
    embedIndice: 0,
    canalId: registro.canalId,
    categoria: 'conexao',
    acao: 'jogador_entrou',
    atorNome: registro.alvoNome,
    atorIdFivem: registro.alvoIdFivem,
    alvoNome: null,
    alvoIdFivem: null,
    valor: null,
    titulo: null,
    descricao: `Entrada implícita: recrutado por ${registro.atorNome ?? `#${registro.atorIdFivem}`} em jogo, sem log de conexão próprio.`,
    ocorridoEm: registro.ocorridoEm,
    bruto: { sintetico: true, origemAcao: 'jogador_recrutou', mensagemId: registro.messageId, embedIndice: registro.embedIndice },
  };
}

// Grava e devolve só os registros que ainda não existiam.
//
// Último ponto de checagem antes do banco (não só o primeiro, em
// ehMensagemDeLog/sincronizarCanal): a contaminação de Fanáticos/Arena
// (2 meses de logs-liderança misturados, ver `canais` em config/index.js)
// só foi notada porque alguém reparou no painel — se o gate de entrada
// (lista de canais + categoria) algum dia for refeito com um bug, sem essa
// segunda checagem aqui o banco volta a acumular linha de outra comunidade
// silenciosamente. `config.logsJogo.canais` é a lista definitiva de fonte
// válida pra QUALQUER inteligência gerada (painéis, alertas, relatórios) —
// nunca inserir nada fora dela, seja qual for o caminho que trouxe o registro.
async function gravarRegistros(registros) {
  const novos = [];
  for (const registro of registros) {
    if (!config.logsJogo.canais.includes(registro.canalId)) {
      console.warn(`[logs-jogo] Registro de canal fora da lista permitida (${registro.canalId}) — ignorado, não gravado.`);
      continue;
    }
    if (!(await repo.inserirRegistro(registro))) continue;
    novos.push(registro);

    if (registro.acao === 'jogador_recrutou' && registro.alvoIdFivem) {
      const ultimaAcao = await repo.ultimaAcaoDeConexao(registro.alvoIdFivem);
      if (ultimaAcao !== 'jogador_entrou') {
        const implicita = montarEntradaImplicita(registro);
        if (await repo.inserirRegistro(implicita)) novos.push(implicita);
      }
    }
  }
  return novos;
}

// Lê o histórico do canal de trás para frente. Incremental (padrão): para no
// primeiro lote em que todos os logs já estão gravados — é o que recupera o que
// chegou com o bot desligado. Completo: relê o canal inteiro.
async function sincronizarCanal(client, canalId, { completo = false } = {}) {
  const canal = await client.channels.fetch(canalId).catch(() => null);
  if (!canal?.isTextBased()) return { canalId, lidas: 0, novas: 0, erro: 'canal não encontrado' };
  // Recusa qualquer canal fora da categoria de logs do Hoolibras — foi assim
  // que 1461544673825783929 ("logs-liderança", categoria "LOGS
  // FANÁTICOS/ARENA", outra comunidade) ficou 2 meses na lista sem ninguém
  // notar, misturando dado de fechadura/novato/advertência/roupa de outro
  // servidor com o nosso. Confirmado pela API do Discord em 2026-09-13.
  if (config.logsJogo.categoriaLogs && canal.parentId !== config.logsJogo.categoriaLogs) {
    return { canalId, lidas: 0, novas: 0, erro: `canal fora da categoria de logs (parent ${canal.parentId}) — ignorado` };
  }

  let antes;
  let lidas = 0;
  let novas = 0;
  for (;;) {
    const lote = await canal.messages.fetch({ limit: 100, ...(antes ? { before: antes } : {}) });
    if (lote.size === 0) break;

    const candidatas = [...lote.values()].filter(ehMensagemDeLog);
    const jaGravadas = await repo.idsJaGravados(candidatas.map(m => m.id));
    for (const msg of candidatas) {
      if (jaGravadas.has(msg.id)) continue;
      novas += (await gravarRegistros(registrosDaMensagem(msg))).length;
    }

    lidas += lote.size;
    antes = lote.last().id;
    if (!completo && candidatas.length > 0 && jaGravadas.size === candidatas.length) break;
    if (lote.size < 100) break;
  }
  return { canalId, lidas, novas };
}

// Regra nova no parser não vale nada pro passado: o log antigo continua gravado
// como 'desconhecido' (e o INSERT da sincronização não atualiza linha que já
// existe — ON CONFLICT DO NOTHING). Aqui o embed cru que ficou guardado em
// `bruto` é relido pelo parser atual e o registro é corrigido no lugar.
//
// Roda no arranque: é barato porque só olha o que AINDA é 'desconhecido' — depois
// de um reprocessamento bem-sucedido não sobra quase nada pra reler. Só toca a
// linha quando a ação realmente mudou.
const REPROCESSAR_MAX = 20000;

async function reprocessarDesconhecidos(limite = REPROCESSAR_MAX) {
  const pendentes = await repo.desconhecidosComBruto(limite);
  let corrigidos = 0;
  for (const linha of pendentes) {
    const novo = parseRegistro(linha.bruto);
    if (novo.acao === 'desconhecido') continue;
    await repo.atualizarRegistroReprocessado(linha.id, novo);
    corrigidos++;
  }
  return { lidos: pendentes.length, corrigidos };
}

async function sincronizarCanaisDeLog(client, opcoes) {
  const resultados = [];
  for (const canalId of config.logsJogo.canais) {
    try {
      resultados.push(await sincronizarCanal(client, canalId, opcoes));
    } catch (err) {
      console.error(`[logs-jogo] Erro ao sincronizar canal ${canalId}:`, err);
      resultados.push({ canalId, lidas: 0, novas: 0, erro: err.message });
    }
  }
  return resultados;
}

module.exports = {
  ehMensagemDeLog,
  registrosDaMensagem,
  montarEntradaImplicita,
  gravarRegistros,
  sincronizarCanaisDeLog,
  reprocessarDesconhecidos,
};
