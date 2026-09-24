module.exports = {
  id: 'antiSpam',
  descricao: 'Anti-spam: detecta conta hackeada espalhando golpe, apaga e avisa a staff',
  padrao: true,
  requer: ['departamentos'],
  carregar() {
    require('../utils/antiSpam/servico'); // registra o prefixo "antispam" (botões BANIR/LIBERAR)
  },

  // Castiga, apaga e avisa; consome a mensagem quando era spam.
  aoMensagem(message) {
    return require('../utils/antiSpam/servico').tratarSpam(message);
  },
};
