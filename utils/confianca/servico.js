const config = require('../../config/index.js');
const { ehLideranca } = require('../permissoes');
const { aoMarcarPresenca } = require('../eventos/interacoes');
const repo = require('./repositorio');
const regras = require('./regras');

// Ponto único de entrada dos sinais de confiança. Quem dispara (evento, recrutamento,
// rifa) só informa o fato; peso, teto e nível são decididos aqui.

async function situacaoDe(discordId, member = null) {
  const eventos = await repo.listarEventos(discordId);
  const score = regras.calcularScore(eventos);
  return {
    score,
    nivel: regras.nivelEfetivo(score, { lideranca: ehLideranca(member) }),
    progresso: regras.progresso(score),
    eventos,
  };
}

// Cargo cosmético por nível, só se configurado (config.confianca.cargosNivel)
async function sincronizarCargoNivel(client, discordId) {
  const cargos = config.confianca?.cargosNivel ?? [];
  if (!cargos.some(Boolean)) return;
  const guild = await client.guilds.fetch(config.guildId);
  const membro = await guild.members.fetch(discordId).catch(() => null);
  if (!membro) return;
  const { nivel } = await situacaoDe(discordId, membro);
  const correto = cargos[nivel.nivel];
  const remover = cargos.filter(id => id && id !== correto && membro.roles.cache.has(id));
  if (remover.length) await membro.roles.remove(remover, 'Nível de confiança');
  if (correto && !membro.roles.cache.has(correto)) await membro.roles.add(correto, 'Nível de confiança');
}

async function registrarSinal(client, { discordId, sinal, origemTipo, origemId, peso }) {
  const def = regras.SINAIS_CONFIANCA[sinal];
  const evento = await repo.registrarEvento({
    discordId,
    sinal,
    peso: peso ?? def?.peso ?? 0,
    origemTipo,
    origemId: String(origemId),
  });
  if (evento && client) {
    await sincronizarCargoNivel(client, discordId).catch(err => console.error('[confianca] Erro ao sincronizar cargo de nível:', err));
  }
  return evento;
}

// Desfaz um sinal já registrado (decisão revertida) e reajusta o cargo de nível.
// `executor` = conexão da transação (ou db); o cargo só é sincronizado depois, por sincronizarDepois().
async function desfazerSinal(executor, { discordId, sinal, origemTipo, origemId }) {
  await repo.removerEvento(executor, { discordId, sinal, origemTipo, origemId: String(origemId) });
}

async function sincronizarDepois(client, discordId) {
  if (client) await sincronizarCargoNivel(client, discordId).catch(err => console.error('[confianca] Erro ao sincronizar cargo de nível:', err));
}

// Presença marcada (manual ou embarque da ida) é o sinal mais caro de forjar
aoMarcarPresenca(async ({ evento, discordIds, client }) => {
  for (const discordId of discordIds) {
    await registrarSinal(client, { discordId, sinal: 'PRESENCA', origemTipo: 'evento', origemId: evento.id });
  }
});

module.exports = { registrarSinal, situacaoDe, desfazerSinal, sincronizarDepois };
