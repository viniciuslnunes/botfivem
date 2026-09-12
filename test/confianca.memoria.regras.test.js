const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../utils/confianca/regras');
const M = require('../utils/memoria/regras');

const agora = new Date('2026-09-11T15:00:00Z');
const diasAtras = n => new Date(agora.getTime() - n * 86400000);

test('presença tem teto na janela de 30 dias; antiga conta metade', () => {
  const recentes = Array.from({ length: 5 }, (_, i) => ({ sinal: 'PRESENCA', peso: 15, criado_em: diasAtras(i + 1) }));
  assert.equal(C.calcularScore(recentes, agora), 45);
  const antigas = Array.from({ length: 2 }, (_, i) => ({ sinal: 'PRESENCA', peso: 15, criado_em: diasAtras(40 + i) }));
  assert.equal(C.calcularScore(antigas, agora), 15);
  assert.equal(C.calcularScore([...recentes, ...antigas], agora), 60);
});

test('reprovação derruba e o score fica entre 0 e 100', () => {
  assert.equal(C.calcularScore([{ sinal: 'REPROVACAO', peso: -40, criado_em: agora }], agora), 0);
  const muito = [
    ...Array.from({ length: 3 }, (_, i) => ({ sinal: 'PRESENCA', peso: 15, criado_em: diasAtras(i) })),
    ...Array.from({ length: 6 }, (_, i) => ({ sinal: 'PRESENCA', peso: 15, criado_em: diasAtras(60 + i) })),
    { sinal: 'APROVACAO', peso: 20, criado_em: agora },
    { sinal: 'RIFA_ACERTO', peso: 20, criado_em: agora },
  ];
  assert.equal(C.calcularScore(muito, agora), 100);
  assert.equal(C.calcularScore([{ sinal: 'APROVACAO', peso: 20, criado_em: agora }, { sinal: 'REPROVACAO', peso: -40, criado_em: agora }], agora), 0);
});

test('níveis, piso da liderança e progresso', () => {
  assert.equal(C.nivelDoScore(0).rotulo, 'Novato');
  assert.equal(C.nivelDoScore(20).rotulo, 'Conhecido');
  assert.equal(C.nivelDoScore(79).rotulo, 'De casa');
  assert.equal(C.nivelDoScore(80).rotulo, 'Referência');
  assert.equal(C.nivelEfetivo(0, { lideranca: true }).rotulo, 'De casa');
  assert.equal(C.nivelEfetivo(90, { lideranca: true }).rotulo, 'Referência');
  assert.deepEqual(C.progresso(35), { proximo: C.NIVEIS_CONFIANCA[2], faltam: 15 });
  assert.equal(C.progresso(100), null);
});

test('memória: data, janela e fato atrasado', () => {
  assert.equal(M.parseDiaMemoria('hoje', agora), '2026-09-11');
  assert.equal(M.parseDiaMemoria('02/07/2025', agora), '2025-07-02');
  assert.equal(M.parseDiaMemoria('30/02/2025', agora), null);
  assert.equal(M.validarDiaMemoria('2019-01-01', agora).ok, false);
  assert.equal(M.validarDiaMemoria('2027-03-01', agora).ok, false);
  assert.equal(M.validarDiaMemoria('2026-11-01', agora).ok, true);
  assert.equal(M.statusInicialDoFato('2026-09-10', agora), 'PENDENTE');
  assert.equal(M.statusInicialDoFato('2026-09-11', agora), 'APROVADA');
  assert.equal(M.tituloDoDia('2026-09-11'), '📅 11/09/2026');
});
