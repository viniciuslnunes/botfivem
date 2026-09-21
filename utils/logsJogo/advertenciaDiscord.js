const config = require('../../config');

// Advertência de sócio vive como cargo (ADV¹/²/³) direto no membro — não tem
// tabela própria nem entra em logs_jogo (isso é jogo, aquilo é Discord). Só
// dá pra saber o nível checando os cargos do membro na hora.
function advertenciaAtivaDoMembro(membro) {
  if (!membro) return null;
  const nivel = config.cargos.adv.findIndex(id => membro.roles.cache.has(id));
  return nivel === -1 ? null : nivel + 1;
}

// null quando não há membro (ex.: ficha aberta sem o GuildMember em mãos) —
// nesse caso quem chama deve OMITIR a linha, nunca mostrar "nenhuma" como se
// tivesse checado (ver regra 1.5: não fingir um estado que não foi confirmado).
function linhaAdvertenciaDiscord(membro) {
  if (!membro) return null;
  const nivel = advertenciaAtivaDoMembro(membro);
  return `**Advertência (Discord):** ${nivel ? `ATIVA — ${nivel}ª` : 'nenhuma'}`;
}

module.exports = { advertenciaAtivaDoMembro, linhaAdvertenciaDiscord };
