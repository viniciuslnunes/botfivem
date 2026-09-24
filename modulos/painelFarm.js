const { manifestoDePainel } = require('./_painelDeLog');

module.exports = manifestoDePainel({
  id: 'painelFarm',
  descricao: '🌾 Inteligência de farm: quem guardou o quê nos baús, ranking e limite diário de retirada',
  arquivo: 'painelFarm',
  iniciar: 'iniciarPainelFarm',
  agendar: 'agendarAtualizacaoReativa',
  categorias: ['bau'],
  requer: ['departamentos'],
});
