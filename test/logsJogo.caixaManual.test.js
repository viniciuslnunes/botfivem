const test = require('node:test');
const assert = require('node:assert/strict');
const {
  deltaCaixa, cabecalhoDinheiro,
} = require('../utils/logsJogo/painelCaixaInteracoes');

// SALDO NO BANCO DA TORCIDA (2026-09-14): número batido à mão pela
// liderança que passa a somar/diminuir sozinho a cada depósito/saque novo
// do webhook. Só cobre as duas funções puras (sem banco) — mesmo padrão de
// logsJogo.presenca.test.js, que também não bate no Postgres.

test('deltaCaixa soma depósitos/conquista/staff e subtrai saques', () => {
  const registros = [
    { acao: 'banco_depositou', valor: 100000 },
    { acao: 'banco_sacou', valor: 1500 },
    { acao: 'dinheiro_conquista', valor: 5000 },
    { acao: 'dinheiro_adicionado', valor: 2000000 },
  ];
  assert.equal(deltaCaixa(registros), 100000 - 1500 + 5000 + 2000000);
});

test('deltaCaixa ignora honra, roupa e ações desconhecidas', () => {
  const registros = [
    { acao: 'honra_adicionada', valor: 50 },
    { acao: 'comprou_roupa', valor: 250 },
    { acao: 'jogador_entrou' },
  ];
  assert.equal(deltaCaixa(registros), 0);
});

test('deltaCaixa de lote vazio é zero', () => {
  assert.equal(deltaCaixa([]), 0);
});

test('cabecalhoDinheiro mostra SALDO NO BANCO DA TORCIDA quando setado', () => {
  const somas = [{ acao: 'banco_depositou', soma: 1000, total: 1 }];
  const texto = cabecalhoDinheiro(somas, 'TUDO', null, { valor: 16203033.1 });
  assert.match(texto, /SALDO NO BANCO DA TORCIDA:\*\* \$ 16\.203\.033,1/);
  // Sempre depois de "Líquido" — é a linha que compara com o número real.
  assert.ok(texto.indexOf('Líquido') < texto.indexOf('SALDO NO BANCO DA TORCIDA'));
});

test('cabecalhoDinheiro sem saldo manual não mostra a linha', () => {
  const somas = [{ acao: 'banco_depositou', soma: 1000, total: 1 }];
  const texto = cabecalhoDinheiro(somas, 'TUDO', null, null);
  assert.doesNotMatch(texto, /SALDO NO BANCO DA TORCIDA/);
});
