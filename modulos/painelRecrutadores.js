const { manifestoDePainel } = require('./_painelDeLog');

// Acorda com entrada/saída de jogador (muda o "online agora" do recrutador) e
// com cada "jogador_recrutou" (muda a contagem de recrutamentos).
module.exports = manifestoDePainel({
  id: 'painelRecrutadores',
  descricao: '🦅 Inteligência de recrutadores: recrutamentos × tempo jogado × retenção (só liderança)',
  arquivo: 'painelRecrutadores',
  iniciar: 'iniciarPainelRecrutadores',
  agendar: 'agendarAtualizacaoReativa',
  categorias: ['conexao'],
  acoes: ['jogador_recrutou'],
});
