const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../utils/carteirinha/regras');

const agora = new Date('2026-09-11T15:00:00Z'); // 12h em São Paulo

test('situação da carteirinha pela data de São Paulo', () => {
  assert.equal(C.situacaoCarteirinha('2026-12-31', agora).situacao, 'VIGENTE');
  const vencendo = C.situacaoCarteirinha('2026-09-30', agora);
  assert.equal(vencendo.situacao, 'VENCENDO');
  assert.equal(vencendo.dias, 19);
  assert.equal(C.textoSituacao(C.situacaoCarteirinha('2026-09-11', agora)), '🟡 VENCE HOJE');
  const vencida = C.situacaoCarteirinha('2026-09-10', agora);
  assert.equal(vencida.situacao, 'VENCIDA');
  assert.equal(C.textoSituacao(vencida), '🔴 VENCIDA HÁ 1 DIA');
  assert.equal(C.situacaoCarteirinha(null, agora).situacao, 'SEM_VALIDADE');
});

test('validade vinda do Postgres como Date (meia-noite local) ou texto', () => {
  assert.equal(C.situacaoCarteirinha(new Date(2026, 8, 30), agora).dias, 19);
  assert.equal(C.chaveDataValidade('2026-09-30T00:00:00.000Z'), '2026-09-30');
  assert.equal(C.chaveDataValidade('lixo'), null);
});

test('renovação: antecipada soma ao prazo atual; vencida conta de hoje; 29/02 vira 01/03', () => {
  assert.equal(C.novaValidadeRenovacao('2026-12-31', agora), '2027-12-31');
  assert.equal(C.novaValidadeRenovacao('2026-01-01', agora), '2027-09-11');
  assert.equal(C.novaValidadeRenovacao(null, agora), '2027-09-11');
  assert.equal(C.novaValidadeRenovacao(null, new Date('2028-02-29T15:00:00Z')), '2029-03-01');
});

test('data no formato brasileiro', () => {
  assert.equal(C.formatarDataBR('2027-01-05'), '05/01/2027');
});
