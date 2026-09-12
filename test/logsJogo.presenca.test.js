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
  assert.deepEqual(P.idsOnline(estado), ['1', '3']);
});

test('série de ocupação acompanha entradas e saídas dentro dos baldes', () => {
  const eventos = [
    { id: 'a', acao: 'jogador_entrou', ocorrido_em: '2026-09-11T00:30:00-03:00' }, // balde 0h
    { id: 'b', acao: 'jogador_entrou', ocorrido_em: '2026-09-11T01:10:00-03:00' }, // balde 1h
    { id: 'a', acao: 'jogador_saiu', ocorrido_em: '2026-09-11T02:05:00-03:00' },  // balde 2h
  ];
  const baldes = E.gerarBaldes(
    new Date('2026-09-11T00:00:00-03:00'),
    new Date('2026-09-11T03:00:00-03:00'),
    E.HORA_MS, E.chaveHora, E.inicioDaHoraSP
  );
  const serie = P.serieDeOcupacao([], eventos, baldes);
  assert.deepEqual(serie.map(b => b.pico), [1, 2, 2]);
  assert.equal(P.picoDoPeriodo([], serie), 2);
});

test('saída sem entrada correspondente só afeta o próprio ID, não o total de quem está online', () => {
  const eventos = [
    { id: 'orfao', acao: 'jogador_saiu', ocorrido_em: '2026-09-11T00:10:00-03:00' },
  ];
  const baldes = E.gerarBaldes(
    new Date('2026-09-11T00:00:00-03:00'),
    new Date('2026-09-11T01:00:00-03:00'),
    E.HORA_MS, E.chaveHora, E.inicioDaHoraSP
  );
  // Com 3 jogadores já online no início do período, a saída órfã de um 4º
  // (que nunca tinha um "entrou" registrado) não pode derrubar os outros 3
  const serie = P.serieDeOcupacao(['x', 'y', 'z'], eventos, baldes);
  assert.equal(serie[0].pico, 3);
});

test('entrada duplicada do mesmo ID sem saída no meio não conta em dobro', () => {
  const eventos = [
    { id: 'a', acao: 'jogador_entrou', ocorrido_em: '2026-09-11T00:10:00-03:00' },
    { id: 'a', acao: 'jogador_entrou', ocorrido_em: '2026-09-11T00:20:00-03:00' }, // reconexão rápida
  ];
  const baldes = E.gerarBaldes(
    new Date('2026-09-11T00:00:00-03:00'),
    new Date('2026-09-11T01:00:00-03:00'),
    E.HORA_MS, E.chaveHora, E.inicioDaHoraSP
  );
  const serie = P.serieDeOcupacao([], eventos, baldes);
  assert.equal(serie[0].pico, 1);
});

test('período maior nunca tem pico menor que um período menor contido nele (sem drift acumulado)', () => {
  // Simula ruído real: várias saídas órfãs intercaladas não podem corroer
  // o pico de um período mais longo abaixo do de um período mais curto
  // contido nele.
  const eventos = [];
  for (let i = 0; i < 50; i++) {
    eventos.push({ id: `orfao-saida-${i}`, acao: 'jogador_saiu', ocorrido_em: `2026-09-0${1 + (i % 9)}T00:00:00-03:00` });
  }
  eventos.push({ id: 'p1', acao: 'jogador_entrou', ocorrido_em: '2026-09-10T10:00:00-03:00' });
  eventos.push({ id: 'p2', acao: 'jogador_entrou', ocorrido_em: '2026-09-10T10:05:00-03:00' });
  eventos.push({ id: 'p3', acao: 'jogador_entrou', ocorrido_em: '2026-09-10T10:10:00-03:00' });
  eventos.sort((a, b) => new Date(a.ocorrido_em) - new Date(b.ocorrido_em));

  const baldesMes = E.gerarBaldes(new Date('2026-09-01T00:00:00-03:00'), new Date('2026-09-11T00:00:00-03:00'), E.DIA_MS, E.chaveDia, E.inicioDoDiaSP);
  const baldesDia = E.gerarBaldes(new Date('2026-09-10T00:00:00-03:00'), new Date('2026-09-11T00:00:00-03:00'), E.HORA_MS, E.chaveHora, E.inicioDaHoraSP);

  const picoMes = P.picoDoPeriodo([], P.serieDeOcupacao([], eventos, baldesMes));
  const picoDia = P.picoDoPeriodo([], P.serieDeOcupacao([], eventos.filter(e => e.ocorrido_em >= '2026-09-10'), baldesDia));
  assert.equal(picoDia, 3);
  assert.ok(picoMes >= picoDia, `pico do mês (${picoMes}) não pode ser menor que o do dia contido nele (${picoDia})`);
});

test('balde de hora e dia no fuso de São Paulo', () => {
  assert.equal(E.chaveHora('2026-09-11T02:30:00Z'), '2026-09-10 23h');
  assert.equal(E.inicioDaHoraSP('2026-09-11T02:30:00Z').toISOString(), '2026-09-11T02:00:00.000Z');
});
