const { manifestoDePainel } = require('./_painelDeLog');

module.exports = manifestoDePainel({
  id: 'painelRestricoes',
  descricao: '⛔ Banidos e impedidos de recrutar no jogo',
  arquivo: 'painelRestricoes',
  iniciar: 'iniciarPainelRestricoes',
  agendar: 'agendarAtualizacaoReativa',
  categorias: ['restricao'],
});
