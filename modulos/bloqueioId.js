// "Não recrutar": lista de IDs do jogo impedidos de entrar (validar, bloquear e
// desbloquear). A lista mora no histórico do canal (utils/naoRecrutar.js).
module.exports = {
  id: 'bloqueioId',
  descricao: 'Não recrutar: validar, bloquear e desbloquear IDs do jogo',
  padrao: true,
  exige: { canais: ['validarId', 'naoRecrutar', 'historicoNaoRecrutar'] },
  comandos: ['bloquearid', 'validarid'],
  carregar() {
    require('../utils/naoRecrutarInteracoes');
  },

  // Mensagem fixa do não recrutar com os botões de bloquear e remover ID
  aoIniciar(client) {
    const { garantirMensagemNaoRecrutar } = require('../utils/mensagemNaoRecrutar');
    return garantirMensagemNaoRecrutar(client)
      .catch(err => console.error('[nao-recrutar] Erro ao atualizar mensagem fixa:', err));
  },

  // Botão nos canais de validar ID e de não recrutar
  aoMensagem(message) {
    return require('../utils/naoRecrutarMensagens').aoMensagem(message);
  },
};
