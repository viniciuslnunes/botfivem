const test = require('node:test');
const assert = require('node:assert/strict');
const { montarEntradaImplicita } = require('../utils/logsJogo/ingestao');

// Entrada implícita de recrutamento (2026-09-15): "Fulano recrutou Beltrano" no
// jogo prova que Beltrano já está em servidor, mesmo sem um "entrou no
// servidor" próprio dele (perda de pacote do webhook). Só a função pura de
// montagem é testada aqui — a decisão de quando gerar (ultimaAcaoDeConexao)
// bate no banco, mesmo padrão do resto de ingestao.js.
test('montarEntradaImplicita vira jogador_entrou/conexao do ALVO recrutado', () => {
  const ocorridoEm = new Date('2026-09-15T04:10:00Z');
  const registro = {
    messageId: '1234567890123456789',
    embedIndice: 2,
    canalId: '1439061028515090524',
    categoria: 'recrutamento',
    acao: 'jogador_recrutou',
    atorNome: 'Tiago Magrão',
    atorIdFivem: '15277',
    alvoNome: 'Gelado Silva',
    alvoIdFivem: '19465',
    ocorridoEm,
  };

  const implicita = montarEntradaImplicita(registro);

  assert.equal(implicita.acao, 'jogador_entrou');
  assert.equal(implicita.categoria, 'conexao');
  assert.equal(implicita.atorIdFivem, '19465');
  assert.equal(implicita.atorNome, 'Gelado Silva');
  assert.equal(implicita.alvoIdFivem, null);
  assert.equal(implicita.canalId, registro.canalId);
  assert.equal(implicita.ocorridoEm, ocorridoEm);
  assert.match(implicita.descricao, /Tiago Magrão/);
  // message_id sintético precisa ser numérico (toda consulta de conexão
  // desempata com `message_id::bigint`) e diferente do log de origem.
  assert.match(implicita.messageId, /^\d+$/);
  assert.notEqual(implicita.messageId, registro.messageId);
});

test('montarEntradaImplicita sem nome do ator cai pro #ID na descrição', () => {
  const registro = {
    messageId: '1',
    embedIndice: 0,
    canalId: '1439061028515090524',
    acao: 'jogador_recrutou',
    atorNome: null,
    atorIdFivem: '15277',
    alvoNome: 'Gelado Silva',
    alvoIdFivem: '19465',
    ocorridoEm: new Date('2026-09-15T04:10:00Z'),
  };

  const implicita = montarEntradaImplicita(registro);
  assert.match(implicita.descricao, /#15277/);
});
