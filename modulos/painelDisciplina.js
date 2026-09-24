const { manifestoDePainel } = require('./_painelDeLog');

module.exports = manifestoDePainel({
  id: 'painelDisciplina',
  descricao: '⚖️ Disciplina do jogo: advertência, expulsão e blacklist',
  arquivo: 'painelDisciplina',
  iniciar: 'iniciarPainelDisciplina',
  agendar: 'agendarAtualizacaoReativa',
  categorias: ['disciplina'],
});
