module.exports = {
  id: 'sorteios',
  descricao: 'Sorteio de brindes entre quem colou no dia (registro diário) ou entre números 1..N, com histórico',
  padrao: true,
  requer: ['departamentos', 'logsJogo'],
  comandos: ['sorteio'],
  carregar() {
    require('../utils/sorteios/interacoes');
    // Lembrete de prêmio por entregar (tarefa agendada)
    require('../utils/sorteios/tarefas');
  },

  // O botão de novo sorteio fica sempre por último (sem canal criado, nada é postado)
  aoIniciar(client) {
    return require('../utils/sorteios/estrutura').garantirPainelNoFim(client);
  },
};
