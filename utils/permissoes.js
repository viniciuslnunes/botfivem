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

// Sócio ou qualquer cargo de hierarquia acima dele. NUNCA inclui visitante ou
// provar-manto — usado para tudo que não pode vazar para quem ainda não é
// sócio efetivo (ex.: convite do grupo de WhatsApp).
function ehSocioOuAcima(member) {
  if (!member) return false;
  return temAlgumCargo(member, [
    config.cargos.socio,
    config.cargos.presidente,
    config.cargos.vicePresidente,
    config.cargos.velhaGuarda,
    config.cargos.diretoria,
    config.cargos.recrutador,
  ]);
}

module.exports = { temAlgumCargo, ehLideranca, ehPresidencia, ehSocioOuAcima, MSG_SO_LIDERANCA };
