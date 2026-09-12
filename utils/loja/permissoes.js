const { ehPresidencia } = require('../permissoes');
const { papelNaArea } = require('../departamentos/acesso');

// Catálogo e estoque: presidência ou gestor de Materiais e Loja.
// Atender pedido (confirmar pagamento): também quem é membro da área.

async function podeGerirLoja(member) {
  return ehPresidencia(member) || (await papelNaArea(member, 'loja')) === 'gestor';
}

async function podeAtenderPedido(member) {
  return ehPresidencia(member) || (await papelNaArea(member, 'loja')) !== null;
}

module.exports = { podeGerirLoja, podeAtenderPedido };
