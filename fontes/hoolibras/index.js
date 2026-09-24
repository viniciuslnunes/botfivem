// Fonte de logs do servidor de FiveM Hoolibras (Registros de Atividade por
// webhook). Contrato: fontes/contrato.js.
const { parseRegistro } = require('./parser');
const { nomePatrimonio } = require('./patrimonio');

module.exports = {
  id: 'hoolibras',
  nome: 'Hoolibras',
  parseRegistro,
  nomePatrimonio,
};
