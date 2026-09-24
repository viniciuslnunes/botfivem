const { manifestoDePainel } = require('./_painelDeLog');

module.exports = manifestoDePainel({
  id: 'painelTags',
  descricao: '🏷️ Tags do jogo: atribuídas e removidas',
  arquivo: 'painelTags',
  iniciar: 'iniciarPainelTags',
  agendar: 'agendarAtualizacaoReativa',
  categorias: ['tag'],
});
