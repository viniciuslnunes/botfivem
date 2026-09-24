module.exports = {
  id: 'memoria',
  descricao: 'Memória da torcida: registro de fatos por dia, moderado pela comunicação',
  padrao: true,
  requer: ['departamentos', 'eventos'],
  comandos: ['memoria'],
  carregar() {
    require('../utils/memoria/interacoes');
  },
};
