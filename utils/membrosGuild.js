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

// O dedupe acima já garante um fetch só por servidor, mas mesmo esse único
// pedido pode nascer rate limitado: no boot, o Discord ainda está de olho no
// orçamento de opcode 8 logo depois do identify, e um redeploy no Railway cai
// bem nessa janela. Isso apareceu nos logs como "Erro ao contar
// sócios"/"Erro ao atualizar" (GatewayRateLimitError) nos 3 chamadores que
// esperavam a mesma promessa — o request.data.retry_after do discord.js diz
// exatamente quanto esperar, então tenta de novo em vez de propagar o erro.
async function buscarComRetry(guild, tentativasRestantes) {
  try {
    return await guild.members.fetch();
  } catch (err) {
    const retryAfter = err?.data?.retry_after;
    if (tentativasRestantes > 0 && typeof retryAfter === 'number') {
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000 + 500));
      return buscarComRetry(guild, tentativasRestantes - 1);
    }
    throw err;
  }
}

async function garantirMembrosCarregados(guild) {
  const existente = emAndamento.get(guild.id);
  if (existente) return existente;
  const promessa = buscarComRetry(guild, 2).finally(() => emAndamento.delete(guild.id));
  emAndamento.set(guild.id, promessa);
  return promessa;
}

module.exports = { garantirMembrosCarregados };
