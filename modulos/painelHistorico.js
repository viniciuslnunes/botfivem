const { manifestoDePainel } = require('./_painelDeLog');

// Ficha cruzada de um jogador: só lê o que os outros painéis já expõem; não
// acorda com log novo (é sob demanda).
module.exports = manifestoDePainel({
  id: 'painelHistorico',
  descricao: '📜 Histórico do associado: ficha cruzada de um jogador (só liderança)',
  arquivo: 'painelHistorico',
  iniciar: 'iniciarPainelHistorico',
});
