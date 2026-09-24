module.exports = {
  id: 'sociais',
  descricao: 'Comandos de texto públicos: !ping, !sociais (redes) e !parceiros',
  padrao: true,
  exige: { links: ['redesSociais'], tenant: ['parceiros'], marca: ['textos.parceiros'] },

  aoMensagem(message) {
    return require('../utils/sociais').aoMensagem(message);
  },
};
