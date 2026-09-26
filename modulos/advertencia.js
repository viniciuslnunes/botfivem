module.exports = {
  id: 'advertencia',
  descricao: 'Advertência de sócio (ADV¹/²/³): registrar, remover, prazo de pagamento e histórico',
  padrao: true,
  // Cruza a advertência do Discord com as restrições do jogo (logs_jogo).
  requer: ['logsJogo'],
  exige: { canais: ['historicoAdv', 'advPendentes'], cargos: ['adv'] },
  carregar() {
    require('../utils/advertencia/interacoes');
    require('../utils/advertencia/pendencias'); // registra o lembrete de prazo
  },
  aoIniciar(client) {
    require('../utils/advertencia/pendencias').iniciarPainel(client); // ⏳・pagamentos-pendentes
  },
  // Impedimento/advertência do painel do jogo e depósito no baú viram advertência (pipeline de logs)
  painelLog: {
    iniciar() {},
    aoRegistros(novos, client) {
      return require('../utils/advertencia/automatica').aoRegistros(novos, client);
    },
  },
};
