const { manifestoDePainel } = require('./_painelDeLog');

// 'bau' acorda dois painéis: este (saldo geral) e painelFarm (só depósito de
// item de farm) — ambos vivem do mesmo log bau_guardou/removeu.
module.exports = manifestoDePainel({
  id: 'painelBau',
  descricao: '📦 Estoque do baú da torcida: guardou/removeu, líquido desde o primeiro log',
  arquivo: 'painelBau',
  iniciar: 'iniciarPainelBau',
  agendar: 'agendarAtualizacaoReativa',
  categorias: ['bau'],
});
