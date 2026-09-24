module.exports = {
  id: 'sugestoes',
  descricao: 'Sugestões de melhoria (processo ou Discord): recrutadores+ enviam, sócios+ votam',
  padrao: true,
  carregar() {
    require('../utils/sugestoes/interacoes');
  },

  // Painel com o botão de enviar (canais.sugestoes null = sem canal, nada é postado)
  aoIniciar(client) {
    return require('../utils/sugestoes/painel').garantirPainelNoFim(client);
  },
};
