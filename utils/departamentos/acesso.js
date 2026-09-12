const config = require('../../config/index.js');
const { buscarDepartamento } = require('./repositorio');

// Papel de alguém numa área: 'gestor', 'membro' ou null. Base dos gates por módulo
// (financeiro, loja, patrimônio…): área não concede nada sozinha, cada módulo decide.
async function papelNaArea(member, slug) {
  if (!member) return null;
  const area = await buscarDepartamento(slug);
  if (!area?.ativo) return null;
  if (area.cargo_gestor_id && member.roles.cache.has(area.cargo_gestor_id)) return 'gestor';
  if (area.cargo_membro_id && member.roles.cache.has(area.cargo_membro_id)) return 'membro';
  return null;
}

// Cargos que atendem uma área em canais privados (pedido da loja etc.)
async function cargosQueAtendem(slug) {
  const area = await buscarDepartamento(slug);
  return [config.cargos.presidente, config.cargos.vicePresidente, area?.cargo_gestor_id, area?.cargo_membro_id].filter(Boolean);
}

module.exports = { papelNaArea, cargosQueAtendem };
