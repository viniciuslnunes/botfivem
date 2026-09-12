const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../utils/eventos/regras');

const agora = new Date('2026-09-11T15:00:00Z');

test('data e hora em São Paulo, com e sem ano', () => {
  assert.equal(R.parseDataHora('20/09 19:30', agora).toISOString(), '2026-09-20T22:30:00.000Z');
  assert.equal(R.parseDataHora('20/09/2026 19h30', agora).toISOString(), '2026-09-20T22:30:00.000Z');
  assert.equal(R.parseDataHora('20/09 às 19h', agora).toISOString(), '2026-09-20T22:00:00.000Z');
  assert.equal(R.parseDataHora('05/01/27 08:00', agora).toISOString(), '2027-01-05T11:00:00.000Z');
});

test('sem ano e já passado vira o ano que vem; hoje mais cedo continua hoje', () => {
  assert.equal(R.parseDataHora('10/01 10:00', agora).toISOString(), '2027-01-10T13:00:00.000Z');
  assert.equal(R.parseDataHora('11/09 08:00', agora).toISOString(), '2026-09-11T11:00:00.000Z');
});

test('data inválida é recusada', () => {
  assert.equal(R.parseDataHora('31/02 10:00', agora), null);
  assert.equal(R.parseDataHora('20/13 10:00', agora), null);
  assert.equal(R.parseDataHora('20/09 25:00', agora), null);
  assert.equal(R.parseDataHora('amanhã', agora), null);
});

test('lotação manda para a lista de espera', () => {
  assert.equal(R.decidirInscricao({ capacidade: null, confirmados: 500 }), 'CONFIRMADO');
  assert.equal(R.decidirInscricao({ capacidade: 10, confirmados: 9 }), 'CONFIRMADO');
  assert.equal(R.decidirInscricao({ capacidade: 10, confirmados: 10 }), 'ESPERA');
});

test('inscrições fecham no início ou no cancelamento', () => {
  assert.equal(R.inscricoesAbertas({ status: 'ATIVO', inicio_em: '2026-09-12T00:00:00Z' }, agora), true);
  assert.equal(R.inscricoesAbertas({ status: 'ATIVO', inicio_em: '2026-09-11T14:00:00Z' }, agora), false);
  assert.equal(R.inscricoesAbertas({ status: 'CANCELADO', inicio_em: '2026-09-12T00:00:00Z' }, agora), false);
});

test('série semanal respeita o máximo', () => {
  const inicio = new Date('2026-09-17T22:00:00Z');
  const datas = R.datasDaSerie(inicio, 3);
  assert.equal(datas.length, 4);
  assert.equal(datas[3].toISOString(), '2026-10-08T22:00:00.000Z');
  assert.equal(R.datasDaSerie(inicio, 50, 12).length, 13);
  assert.equal(R.datasDaSerie(inicio, 0).length, 1);
});

test('presença: taxa, avulsos e quem confirmou e não veio', () => {
  const p = R.resumirPresenca([
    { status: 'CONFIRMADO', presente_em: new Date() },
    { status: 'CONFIRMADO', presente_em: null },
    { status: 'CONFIRMADO', presente_em: new Date() },
    { status: 'ESPERA', presente_em: null },
    { status: 'AVULSO', presente_em: new Date() },
    { status: 'DESISTIU', presente_em: null },
  ]);
  assert.deepEqual(p, { confirmados: 3, espera: 1, presentes: 3, avulsos: 1, noShow: 1, taxa: 1 });
  assert.equal(R.resumirPresenca([]).taxa, null);
  assert.equal(R.formatarTaxa(2 / 3), '67%');
});
