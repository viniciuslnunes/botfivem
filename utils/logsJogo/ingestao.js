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

// Grava e devolve só os registros que ainda não existiam
async function gravarRegistros(registros) {
  const novos = [];
  for (const registro of registros) {
    if (await repo.inserirRegistro(registro)) novos.push(registro);
  }
  return novos;
}

// Lê o histórico do canal de trás para frente. Incremental (padrão): para no
// primeiro lote em que todos os logs já estão gravados — é o que recupera o que
// chegou com o bot desligado. Completo: relê o canal inteiro.
async function sincronizarCanal(client, canalId, { completo = false } = {}) {
  const canal = await client.channels.fetch(canalId).catch(() => null);
  if (!canal?.isTextBased()) return { canalId, lidas: 0, novas: 0, erro: 'canal não encontrado' };

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

module.exports = { ehMensagemDeLog, registrosDaMensagem, gravarRegistros, sincronizarCanaisDeLog };
