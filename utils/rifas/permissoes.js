const { ehLideranca, ehPresidencia } = require('../permissoes');
const { papelNaArea } = require('../departamentos/acesso');

// Rifa é da área Social e Eventos, mas a área não concede nada sozinha:
// - criar, encerrar, marcar data, sortear e cancelar: presidência ou gestor do Social;
// - conferir pagamento: esses e o gestor do Financeiro;
// - acompanhar o relatório: a liderança também.
// Comprar não é permissão: é ser sócio (conferido no botão).

async function podeGerirRifas(member) {
  return ehPresidencia(member) || (await papelNaArea(member, 'social')) === 'gestor';
}

async function podeConfirmarPagamentos(member) {
  return (await podeGerirRifas(member)) || (await papelNaArea(member, 'financeiro')) === 'gestor';
}

async function podeVerRifas(member) {
  return ehLideranca(member) || (await podeConfirmarPagamentos(member));
}

module.exports = { podeGerirRifas, podeConfirmarPagamentos, podeVerRifas };
