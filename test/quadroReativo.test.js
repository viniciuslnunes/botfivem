const test = require('node:test');
const assert = require('node:assert/strict');
const { ehMovimentoDeRecrutador } = require('../utils/quadroRecrutadores');

test('só promoção/rebaixamento envolvendo recrutador acorda o quadro', () => {
  assert.ok(ehMovimentoDeRecrutador({ acao: 'promoveu_cargo', descricao: 'promoveu X (Sócio > Recrutador).' }));
  assert.ok(ehMovimentoDeRecrutador({ acao: 'rebaixou_cargo', descricao: 'rebaixou X (Recrutador > Sócio)' }));
  assert.ok(!ehMovimentoDeRecrutador({ acao: 'promoveu_cargo', descricao: 'promoveu X (Sócio > Capitão)' }));
  assert.ok(!ehMovimentoDeRecrutador({ acao: 'jogador_entrou', descricao: 'Recrutador entrou' }));
});
