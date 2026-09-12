const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../utils/logsJogo/presenca');
const E = require('../utils/logsJogo/estatisticas');

test('total e lista de online a partir do estado (só quem entrou por último)', () => {
  const estado = [
    { id: '1', nome: 'Ana', acao: 'jogador_entrou', ocorrido_em: '2026-09-11T10:00:00Z' },
    { id: '2', nome: 'Bia', acao: 'jogador_saiu', ocorrido_em: '2026-09-11T09:00:00Z' },
    { id: '3', nome: 'Caio', acao: 'jogador_entrou', ocorrido_em: '2026-09-11T09:30:00Z' },
  ];
  assert.equal(P.totalOnline(estado), 2);
  assert.deepEqual(P.listaOnline(estado).map(j => j.nome), ['Caio', 'Ana']);
});

test('série de ocupação acompanha entradas e saídas dentro dos baldes', () => {
  const eventos = [
    { acao: 'jogador_entrou', ocorrido_em: '2026-09-11T00:30:00-03:00' }, // balde 0h
    { acao: 'jogador_entrou', ocorrido_em: '2026-09-11T01:10:00-03:00' }, // balde 1h
    { acao: 'jogador_saiu', ocorrido_em: '2026-09-11T02:05:00-03:00' },  // balde 2h
  ];
  const baldes = E.gerarBaldes(
    new Date('2026-09-11T00:00:00-03:00'),
    new Date('2026-09-11T03:00:00-03:00'),
    E.HORA_MS, E.chaveHora, E.inicioDaHoraSP
  );
  const serie = P.serieDeOcupacao(0, eventos, baldes);
  assert.deepEqual(serie.map(b => b.pico), [1, 2, 2]);
  assert.equal(P.picoDoPeriodo(0, serie), 2);
});

test('saída sem entrada correspondente não deixa o contador negativo', () => {
  const eventos = [{ acao: 'jogador_saiu', ocorrido_em: '2026-09-11T00:10:00-03:00' }];
  const baldes = E.gerarBaldes(
    new Date('2026-09-11T00:00:00-03:00'),
    new Date('2026-09-11T01:00:00-03:00'),
    E.HORA_MS, E.chaveHora, E.inicioDaHoraSP
  );
  const serie = P.serieDeOcupacao(0, eventos, baldes);
  assert.equal(serie[0].pico, 0);
});

test('balde de hora e dia no fuso de São Paulo', () => {
  assert.equal(E.chaveHora('2026-09-11T02:30:00Z'), '2026-09-10 23h');
  assert.equal(E.inicioDaHoraSP('2026-09-11T02:30:00Z').toISOString(), '2026-09-11T02:00:00.000Z');
});
