module.exports = {
  id: 'escala',
  descricao: 'Escala de funções dos eventos: convocar, aceitar e recusar',
  padrao: true,
  requer: ['departamentos', 'eventos'],
  comandos: ['escala'],
  carregar() {
    require('../utils/escala/interacoes');
  },
};
