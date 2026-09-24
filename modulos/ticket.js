module.exports = {
  id: 'ticket',
  descricao: 'Tickets privados de atendimento (parceria, denúncia, recrutamento) com transcript ao fechar',
  padrao: true,
  exige: { canais: ['ticket', 'logsTicket'], categorias: ['tickets'] },
  carregar() {
    require('../utils/ticketInteracoes');
  },

  // Mensagem fixa com o botão de abrir ticket (só se ainda não existir)
  aoIniciar(client) {
    return require('../utils/ticket').garantirMensagemTicket(client);
  },
};
