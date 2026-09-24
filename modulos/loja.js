module.exports = {
  id: 'loja',
  descricao: 'Loja da torcida: catálogo, estoque e pedidos pagos em dinheiro do jogo',
  padrao: true,
  requer: ['departamentos', 'financeiro'],
  comandos: ['loja'],
  carregar() {
    require('../utils/loja/interacoes');
  },
};
