const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../utils/loja/regras');

test('estoque por tamanho ou unidade', () => {
  assert.deepEqual(L.parseEstoque('P:10, m:5; G=0'), { P: 10, M: 5, G: 0 });
  assert.deepEqual(L.parseEstoque('20'), { UN: 20 });
  assert.equal(L.parseEstoque('P10'), null);
  assert.equal(L.parseEstoque(''), null);
});

test('tamanhos em ordem e só os disponíveis', () => {
  const estoque = { GG: 1, P: 2, M: 0, XX: 3 };
  assert.deepEqual(L.tamanhosOrdenados(estoque), ['P', 'M', 'GG', 'XX']);
  assert.deepEqual(L.tamanhosDisponiveis(estoque), ['P', 'GG', 'XX']);
  assert.equal(L.formatarEstoque({ UN: 7 }), '7 un.');
  assert.equal(L.formatarEstoque({ P: 1, M: 0 }), 'P: 1 · M: 0');
  assert.equal(L.formatarEstoque({}), 'SEM ESTOQUE');
});

test('pedido respeita estoque e limite por pedido', () => {
  const estoque = { P: 3 };
  assert.equal(L.validarPedido({ estoque, tamanho: 'P', quantidade: 3 }).ok, true);
  assert.equal(L.validarPedido({ estoque, tamanho: 'P', quantidade: 4 }).ok, false);
  assert.equal(L.validarPedido({ estoque, tamanho: 'M', quantidade: 1 }).ok, false);
  assert.equal(L.validarPedido({ estoque: { UN: 50 }, tamanho: 'UN', quantidade: 11 }).ok, false);
  assert.equal(L.validarPedido({ estoque, tamanho: 'P', quantidade: 1.5 }).ok, false);
});

test('reserva e devolução de estoque, total com centavos', () => {
  assert.deepEqual(L.ajustarEstoque({ P: 3, M: 1 }, 'P', -2), { P: 1, M: 1 });
  assert.deepEqual(L.ajustarEstoque({ P: 1 }, 'P', 2), { P: 3 });
  assert.deepEqual(L.ajustarEstoque({ P: 1 }, 'P', -5), { P: 0 });
  assert.equal(L.totalPedido('19.90', 3), 59.7);
});
