const { manifestoDePainel } = require('./_painelDeLog');

module.exports = manifestoDePainel({
  id: 'painelFechaduras',
  descricao: '🔐 Fechaduras: estado de sede e portões (trancado/destrancado)',
  arquivo: 'painelFechaduras',
  iniciar: 'iniciarPainelFechaduras',
  agendar: 'agendarAtualizacaoReativa',
  categorias: ['patrimonio'],
});
