module.exports = {
  id: 'eventos',
  descricao: 'Eventos da torcida: criação, séries semanais, confirmação de presença, lista de espera e lembretes',
  padrao: true,
  requer: ['departamentos'],
  comandos: ['evento'],
  carregar() {
    require('../utils/eventos/interacoes');
  },

  // Confirmar/recusar por reação (🦅/❌) na mensagem do evento
  aoReacaoAdicionada(reaction, user) {
    return require('../utils/eventos/reacoes').tratarReacaoDeEvento(reaction, user);
  },
  aoReacaoRemovida(reaction, user) {
    return require('../utils/eventos/reacoes').tratarReacaoDeEvento(reaction, user);
  },
};
