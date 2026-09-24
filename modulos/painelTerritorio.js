const { manifestoDePainel } = require('./_painelDeLog');

module.exports = manifestoDePainel({
  id: 'painelTerritorio',
  descricao: '🗺️ Domínio de territórios: conquista, perda e prêmio',
  arquivo: 'painelTerritorio',
  iniciar: 'iniciarPainelTerritorio',
  agendar: 'agendarAtualizacaoReativa',
  categorias: ['territorio'],
});
