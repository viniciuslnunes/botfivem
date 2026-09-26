const config = require('../config/index.js');

// A lista "não recrutar" vive como embeds no canal de histórico. Ler só as 100
// últimas mensagens deixava passar ID bloqueado; aqui o histórico inteiro é
// paginado e guardado em cache curto, invalidado a cada bloqueio/desbloqueio.
const CACHE_MS = 5 * 60 * 1000;
let cache = null; // { carregadoEm, porId: Map<idFivem, Message[]> }

async function lerHistoricoCompleto(canal) {
  const mensagens = [];
  let antes;
  for (;;) {
    const lote = await canal.messages.fetch({ limit: 100, ...(antes ? { before: antes } : {}) });
    if (lote.size === 0) break;
    mensagens.push(...lote.values());
    antes = lote.last().id;
    if (lote.size < 100) break;
  }
  return mensagens;
}

// Bloqueio desfeito renomeia o campo para "ID (DESBLOQUEADO)", então não casa aqui
function idDoBloqueio(msg) {
  const campo = msg.embeds?.[0]?.fields?.find(f => f.name === 'ID');
  return campo ? campo.value.trim() : null;
}

async function carregarBloqueios(client) {
  if (cache && Date.now() - cache.carregadoEm < CACHE_MS) return cache.porId;
  const canal = await client.channels.fetch(config.canais.historicoNaoRecrutar).catch(() => null);
  if (!canal?.isTextBased()) throw new Error('Canal de histórico de não recrutar não encontrado.');

  const historico = await lerHistoricoCompleto(canal);
  require('./naoRecrutarEspelho').espelhar(historico); // tabela para cruzar dados; não espera
  const porId = new Map();
  for (const msg of historico) {
    const id = idDoBloqueio(msg);
    if (!id) continue;
    if (!porId.has(id)) porId.set(id, []);
    porId.get(id).push(msg);
  }
  cache = { carregadoEm: Date.now(), porId };
  return porId;
}

async function mensagensDoBloqueio(client, idFivem) {
  const porId = await carregarBloqueios(client);
  return porId.get(String(idFivem).trim()) ?? [];
}

// Embed do bloqueio mais recente do ID, ou null se o ID está liberado
async function buscarBloqueio(client, idFivem) {
  const mensagens = await mensagensDoBloqueio(client, idFivem);
  return mensagens.length ? mensagens[0].embeds[0] : null;
}

function invalidarCacheBloqueios() {
  cache = null;
}

module.exports = { buscarBloqueio, mensagensDoBloqueio, invalidarCacheBloqueios };
