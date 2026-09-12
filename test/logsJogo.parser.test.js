const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRegistro, extrairValor, extrairCategoria } = require('../utils/logsJogo/parser');

test('novato no formato real do webhook', () => {
  const r = parseRegistro({
    title: 'Registro de Atividade: Rarin Dimarolla',
    description: 'O Novato Rarin Dimarolla (ID: 8914 ) entrou na sua torcida Novato.',
    footer: { text: 'Time: Gaviões da Fiel | Categoria: lideranca • Hoje às 20:15' },
  });
  assert.equal(r.acao, 'novato_entrou');
  assert.equal(r.atorNome, 'Rarin Dimarolla');
  assert.equal(r.atorIdFivem, '8914');
  assert.equal(r.categoria, 'lideranca');
});

test('novato no formato do /testenovato (com negrito)', () => {
  const r = parseRegistro({
    title: 'Registro de Atividade: Teste Novato',
    description: 'O Novato **Teste Novato** (ID: **9999**) entrou na sua torcida **Novato**.',
    footer: { text: 'Time: Gaviões da Fiel | Categoria: lideranca • Hoje às 10:00' },
  });
  assert.equal(r.acao, 'novato_entrou');
  assert.equal(r.atorNome, 'Teste Novato');
  assert.equal(r.atorIdFivem, '9999');
});

test('entrada de jogador no formato do canal logs-painel', () => {
  const r = parseRegistro({
    title: 'Entrada',
    description: '#13138 Will lhp entrou no servidor.',
  });
  assert.equal(r.acao, 'jogador_entrou');
  assert.equal(r.atorNome, 'Will lhp');
  assert.equal(r.atorIdFivem, '13138');
  assert.equal(r.categoria, 'conexao');
});

test('saída de jogador no formato do canal logs-painel', () => {
  const r = parseRegistro({
    title: 'Saída',
    description: '#19200 Bigode lmzz saiu do servidor.',
  });
  assert.equal(r.acao, 'jogador_saiu');
  assert.equal(r.atorNome, 'Bigode lmzz');
  assert.equal(r.atorIdFivem, '19200');
  assert.equal(r.categoria, 'conexao');
});

test('recrutamento do próprio jogo (canal logs-recrutamento)', () => {
  const r = parseRegistro({
    title: 'Recrutamento',
    description: '#15277 Tiago Magrão recrutou #19465 Gelado Silva.',
  });
  assert.equal(r.acao, 'jogador_recrutou');
  assert.equal(r.atorNome, 'Tiago Magrão');
  assert.equal(r.atorIdFivem, '15277');
  assert.equal(r.alvoNome, 'Gelado Silva');
  assert.equal(r.alvoIdFivem, '19465');
  assert.equal(r.categoria, 'recrutamento');
});

test('formato desconhecido é mantido, com IDs e valor extraídos', () => {
  const r = parseRegistro({
    title: 'Registro de Atividade: Fulano',
    description: 'Fulano (ID: 12) depositou $ 1.500 no baú para Ciclano (ID: 34).',
    footer: { text: 'Time: Gaviões da Fiel | Categoria: Bau' },
  });
  assert.equal(r.acao, 'desconhecido');
  assert.equal(r.atorNome, 'Fulano');
  assert.equal(r.atorIdFivem, '12');
  assert.equal(r.alvoIdFivem, '34');
  assert.equal(r.valor, 1500);
  assert.equal(r.categoria, 'bau');
  assert.match(r.descricao, /depositou/);
});

test('campos do embed entram no texto analisado', () => {
  const r = parseRegistro({ fields: [{ name: 'Quantia', value: 'R$ 2.345,50' }] });
  assert.equal(r.valor, 2345.5);
  assert.equal(r.categoria, null);
  assert.equal(r.atorNome, null);
});

test('valores em dinheiro do jogo', () => {
  assert.equal(extrairValor('$2500'), 2500);
  assert.equal(extrairValor('$ 1.234.567'), 1234567);
  assert.equal(extrairValor('R$ 10,5'), 10.5);
  assert.equal(extrairValor('sem dinheiro (ID: 8914)'), null);
});

test('categoria no rodapé', () => {
  assert.equal(extrairCategoria('Time: X | Categoria: Membros • Ontem'), 'membros');
  assert.equal(extrairCategoria('sem categoria'), null);
});
