const { PermissionFlagsBits } = require('discord.js');
const config = require('../config/index.js');

// Permissão é cargo conferido no handler — esconder botão ou comando não basta.

function temAlgumCargo(member, cargoIds) {
  return Boolean(member) && cargoIds.some(id => id && member.roles.cache.has(id));
}

function ehLideranca(member) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  return temAlgumCargo(member, config.lideranca);
}

// Presidente e vice: decisões de governança (ex.: definir gestor de área)
function ehPresidencia(member) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  return temAlgumCargo(member, [config.cargos.presidente, config.cargos.vicePresidente]);
}

const MSG_SO_LIDERANCA = '❌ APENAS A LIDERANÇA (PRESIDÊNCIA, VELHA GUARDA E DIRETORIA) PODE USAR ESTE RECURSO.';

module.exports = { temAlgumCargo, ehLideranca, ehPresidencia, MSG_SO_LIDERANCA };
