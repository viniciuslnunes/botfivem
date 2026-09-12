const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../utils/financeiro/regras');

test('valor em dinheiro do jogo', () => {
  assert.equal(F.parseValor('1500'), 1500);
  assert.equal(F.parseValor('1.500'), 1500);
  assert.equal(F.parseValor('$ 2.500,50'), 2500.5);
  assert.equal(F.parseValor('1,500'), 1500);
  assert.equal(F.parseValor('10,5'), 10.5);
  assert.equal(F.parseValor('0'), null);
  assert.equal(F.parseValor('-10'), null);
  assert.equal(F.parseValor('abc'), null);
});

test('data de competência', () => {
  const agora = new Date('2026-09-11T15:00:00Z');
  assert.equal(F.parseDataLancamento(null, agora), '2026-09-11');
  assert.equal(F.parseDataLancamento('05/09', agora), '2026-09-05');
  assert.equal(F.parseDataLancamento('05/09/2025', agora), '2025-09-05');
  assert.equal(F.parseDataLancamento('31/02/2026', agora), null);
  assert.equal(F.parseDataLancamento('01/01/2028', agora), null);
  assert.equal(F.parseDataLancamento('01/01/1999', agora), null);
});

test('saldo derivado e totais por categoria', () => {
  const r = F.resumirLancamentos([
    { tipo: 'RECEITA', categoria: 'LOJA', total: 1000 },
    { tipo: 'RECEITA', categoria: 'RIFA', total: 250.25 },
    { tipo: 'DESPESA', categoria: 'CARAVANA', total: 400.1 },
    { tipo: 'DESPESA', categoria: 'LOJA', total: 100 },
  ]);
  assert.equal(r.receitas, 1250.25);
  assert.equal(r.despesas, 500.1);
  assert.equal(r.saldo, 750.15);
  assert.deepEqual(r.porCategoria[0], { categoria: 'LOJA', receitas: 1000, despesas: 100 });
});
