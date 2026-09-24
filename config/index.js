// Configuração do tenant ativo (TENANT, default "gavioes"): carrega
// tenants/<slug>/tenant.js, valida com config/schema.js e congela. Falha na
// subida, listando TODOS os problemas, em vez de quebrar em runtime no meio de
// um fluxo. O formato (config.canais, config.cargos, config.logsJogo…) é o
// mesmo que os módulos sempre usaram.
const { slug, raiz } = require('../tenants/ativo');
const { carregarTenant } = require('./carregar');

module.exports = carregarTenant(slug, { raiz });
