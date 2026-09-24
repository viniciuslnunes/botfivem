const { manifestoDePainel } = require('./_painelDeLog');

module.exports = manifestoDePainel({
  id: 'painelCaixa',
  descricao: '🏦 Caixa do jogo: depósito, saque e saldo do banco da torcida (manual + ajuste automático)',
  arquivo: 'painelCaixa',
  iniciar: 'iniciarPainelCaixa',
  agendar: 'agendarAtualizacaoReativa',
  categorias: ['economia'],
  // Depósito/saque novo: soma (ou subtrai) por cima do SALDO NO BANCO DA
  // TORCIDA batido à mão (só ajusta se a liderança já setou algum valor
  // pelo botão EDITAR — ver incrementarSaldoCaixaManual).
  async aoRegistrosExtra(novos) {
    const { deltaCaixa, incrementarSaldoCaixaManual } = require('../utils/logsJogo/painelCaixaInteracoes');
    const delta = deltaCaixa(novos);
    if (delta) {
      await incrementarSaldoCaixaManual(delta).catch(err => console.error('[logs-jogo] Erro ao ajustar saldo do caixa:', err));
    }
  },
});
