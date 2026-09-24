module.exports = {
  id: 'advertencia',
  descricao: 'Advertência de sócio (ADV¹/²/³): registrar, remover, prazo de pagamento e histórico',
  padrao: true,
  // Cruza a advertência do Discord com as restrições do jogo (logs_jogo).
  requer: ['logsJogo'],
  exige: { canais: ['historicoAdv', 'advPendentes'], cargos: ['adv'] },
  carregar() {
    require('../utils/advertencia/interacoes');
  },
};
