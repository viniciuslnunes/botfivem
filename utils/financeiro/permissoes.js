const { ehLideranca, ehPresidencia } = require('../permissoes');
const { papelNaArea } = require('../departamentos/acesso');

// Ver o caixa: liderança ou quem é da área Financeiro.
// Lançar/excluir: presidência ou gestor do Financeiro (diretoria acompanha em leitura).

async function podeVerFinanceiro(member) {
  return ehLideranca(member) || (await papelNaArea(member, 'financeiro')) !== null;
}

async function podeLancarFinanceiro(member) {
  return ehPresidencia(member) || (await papelNaArea(member, 'financeiro')) === 'gestor';
}

module.exports = { podeVerFinanceiro, podeLancarFinanceiro };
