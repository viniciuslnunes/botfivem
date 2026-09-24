const fs = require('fs');
const path = require('path');
const { validarTenant } = require('./schema');

const RAIZ_TENANTS = path.join(__dirname, '..', 'tenants');

function congelarProfundo(obj) {
  for (const v of Object.values(obj)) if (v && typeof v === 'object') congelarProfundo(v);
  return Object.freeze(obj);
}

// Carrega, valida e congela o tenant. `raiz` existe só para teste (fixtures).
function carregarTenant(slug, { raiz = RAIZ_TENANTS } = {}) {
  const arquivo = path.join(raiz, slug, 'tenant.js');
  // Existência checada à parte: um require que falha DENTRO do tenant.js
  // (dependência ausente, erro de sintaxe) precisa aparecer como ele é.
  if (!fs.existsSync(arquivo)) {
    throw new Error(`Tenant "${slug}" não encontrado: esperado tenants/${slug}/tenant.js`);
  }
  const tenant = require(arquivo);
  const erros = validarTenant(tenant, slug);
  if (erros.length) {
    throw new Error(`Tenant "${slug}" inválido:\n - ${erros.join('\n - ')}`);
  }
  return congelarProfundo(structuredClone(tenant));
}

module.exports = { carregarTenant };
