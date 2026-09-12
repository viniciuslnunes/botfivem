// Dedupe de guild.members.fetch() — vários módulos independentes (painel de
// jogadores, sócios-sem-id, IDs-sem-sócio, reconciliação de carteirinhas,
// quadro de departamentos, alerta de novatos...) buscam a lista completa de
// membros na sua própria rotina, sem saber dos outros. No boot (ready.js)
// isso faz meia dúzia deles chamarem guild.members.fetch() quase ao mesmo
// tempo: cada fetch() pede o chunk completo de membros pelo gateway
// (opcode 8), e vários pedidos simultâneos pro mesmo servidor estouram o
// rate limit do Discord (GatewayRateLimitError, retry_after de até ~30s) —
// foi isso que causou os "Erro ao contar sócios"/"Erro ao atualizar" logo
// após o deploy, e pode atrasar interações que dependem do mesmo fetch.
//
// Aqui, uma chamada concorrente para o mesmo servidor espera o fetch que já
// está em andamento em vez de disparar um pedido próprio. Não cacheia depois
// de pronto (cada chamador continua enxergando guild.members.cache
// atualizado do jeito que já esperava) — só evita a rajada de pedidos
// simultâneos.
const emAndamento = new Map(); // guildId -> Promise

async function garantirMembrosCarregados(guild) {
  const existente = emAndamento.get(guild.id);
  if (existente) return existente;
  const promessa = guild.members.fetch().finally(() => emAndamento.delete(guild.id));
  emAndamento.set(guild.id, promessa);
  return promessa;
}

module.exports = { garantirMembrosCarregados };
