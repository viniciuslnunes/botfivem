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

test('reconexão rápida (mesmo ID) funde as duas visitas numa sessão só', () => {
  const eventos = [
    { id: 'a', nome: 'Ana', acao: 'jogador_entrou', ocorrido_em: '2026-09-11T10:00:00Z' },
    { id: 'a', nome: 'Ana', acao: 'jogador_saiu', ocorrido_em: '2026-09-11T10:30:00Z' },
    { id: 'a', nome: 'Ana', acao: 'jogador_entrou', ocorrido_em: '2026-09-11T10:31:00Z' }, // 1min depois: queda de conexão
    { id: 'a', nome: 'Ana', acao: 'jogador_saiu', ocorrido_em: '2026-09-11T12:00:00Z' },
  ];
  const unificado = P.unificarReconexoesRapidas(eventos, 2 * 60 * 1000);
  assert.deepEqual(unificado.map(e => e.acao), ['jogador_entrou', 'jogador_saiu']);
  assert.equal(unificado[0].ocorrido_em, '2026-09-11T10:00:00Z');
  assert.equal(unificado[1].ocorrido_em, '2026-09-11T12:00:00Z');
});

test('reconexão fora da folga continua como duas visitas distintas', () => {
  const eventos = [
    { id: 'a', acao: 'jogador_entrou', ocorrido_em: '2026-09-11T10:00:00Z' },
    { id: 'a', acao: 'jogador_saiu', ocorrido_em: '2026-09-11T10:30:00Z' },
    { id: 'a', acao: 'jogador_entrou', ocorrido_em: '2026-09-11T14:00:00Z' }, // 3h30 depois: visita de verdade
    { id: 'a', acao: 'jogador_saiu', ocorrido_em: '2026-09-11T15:00:00Z' },
  ];
  const unificado = P.unificarReconexoesRapidas(eventos, 2 * 60 * 1000);
  assert.equal(unificado.length, 4);
});

test('reconexão rápida não confunde jogadores diferentes intercalados', () => {
  const eventos = [
    { id: 'a', acao: 'jogador_entrou', ocorrido_em: '2026-09-11T10:00:00Z' },
    { id: 'b', acao: 'jogador_entrou', ocorrido_em: '2026-09-11T10:05:00Z' },
    { id: 'a', acao: 'jogador_saiu', ocorrido_em: '2026-09-11T10:10:00Z' },
    { id: 'a', acao: 'jogador_entrou', ocorrido_em: '2026-09-11T10:11:00Z' }, // reconexão do "a", não do "b"
    { id: 'b', acao: 'jogador_saiu', ocorrido_em: '2026-09-11T11:00:00Z' },
    { id: 'a', acao: 'jogador_saiu', ocorrido_em: '2026-09-11T12:00:00Z' },
  ];
  const unificado = P.unificarReconexoesRapidas(eventos, 2 * 60 * 1000);
  assert.deepEqual(unificado.map(e => `${e.id}:${e.acao}`), [
    'a:jogador_entrou', 'b:jogador_entrou', 'b:jogador_saiu', 'a:jogador_saiu',
  ]);
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

const HORA_MS = 60 * 60 * 1000;

test('sessão sem saída há mais tempo que o limite não aparece como online (caso real: "há um mês")', () => {
  const estado = [
    { id: 'arthurzin', nome: 'Arthurzin', acao: 'jogador_entrou', ocorrido_em: '2026-07-28T20:17:32.032Z' },
    { id: 'ativo', nome: 'Ativo', acao: 'jogador_entrou', ocorrido_em: '2026-09-12T02:00:00.000Z' },
  ];
  const agora = new Date('2026-09-12T03:00:00.000Z'); // Arthurzin: ~45 dias parado; Ativo: 1h
  const filtrado = P.estadoSemSessoesExpiradas(estado, 8 * HORA_MS, agora);
  assert.deepEqual(filtrado.map(e => e.id), ['ativo']);
});

test('fecha sozinha uma sessão do baseline que expira no meio do período, sem afetar quem entrou depois', () => {
  const baseline = [{ id: 'preso', nome: 'Preso', acao: 'jogador_entrou', ocorrido_em: '2026-09-01T00:00:00-03:00' }];
  const eventos = [{ id: 'novo', nome: 'Novo', acao: 'jogador_entrou', ocorrido_em: '2026-09-01T20:00:00-03:00' }];
  const limiteMs = 8 * HORA_MS;
  const fimPeriodo = new Date('2026-09-02T00:00:00-03:00');

  const ajustados = P.comFechamentosAutomaticos(baseline, eventos, limiteMs, fimPeriodo);
  // "preso" ganha uma saída sintética 8h depois do início (00:00 + 8h = 08:00)
  const saidaSintetica = ajustados.find(e => e.id === 'preso' && e.acao === 'jogador_saiu');
  assert.ok(saidaSintetica, 'deveria ter fechado a sessão presa sozinha');
  assert.equal(new Date(saidaSintetica.ocorrido_em).toISOString(), new Date('2026-09-01T08:00:00-03:00').toISOString());

  const baldes = E.gerarBaldes(new Date('2026-09-01T00:00:00-03:00'), fimPeriodo, HORA_MS, E.chaveHora, E.inicioDaHoraSP);
  const serie = P.serieDeOcupacao(['preso'], ajustados, baldes);
  // Pico nunca passa de 2 (preso + novo ao mesmo tempo não ocorre: preso já fechou às 8h, novo só entra às 20h)
  assert.ok(Math.max(...serie.map(b => b.pico)) <= 1, 'preso e novo não podem ter se sobreposto');
});

test('tempo jogado de uma sessão presa também é limitado pelo fechamento automático', () => {
  const baseline = [{ id: 'preso', nome: 'Preso', acao: 'jogador_entrou', ocorrido_em: '2026-09-01T00:00:00-03:00' }];
  const limiteMs = 8 * HORA_MS;
  const inicio = new Date('2026-09-01T00:00:00-03:00');
  const fim = new Date('2026-09-05T00:00:00-03:00'); // 4 dias depois, sem nunca ter saído
  const ajustados = P.comFechamentosAutomaticos(baseline, [], limiteMs, fim);
  const tempo = P.tempoJogadoPorPeriodo(baseline, ajustados, inicio, fim);
  assert.equal(tempo.get('preso').ms, limiteMs); // e não 4 dias inteiros
});

// Casos reais do canal logs-painel (2026-09-12): o webhook manda vários
// eventos JUNTOS numa mensagem só, e todo mundo daquele lote recebe o MESMO
// `ocorrido_em` (é a hora da mensagem, não do evento — ver ingestao.js e o
// desempate por embed_indice em repositorio.js). Estes testes replicam esse
// ruído (múltiplas entradas seguidas sem saída, saída+entrada no mesmo
// instante) já na ordem correta (a que o SQL desempatado devolve), pra travar
// que a intel de presença ignora o ruído sem contar ninguém em dobro.
test('múltiplas entradas seguidas do mesmo ID (mensagem duplicando o evento) contam uma sessão só', () => {
  // Caso real: "#1932 baiano dobronx entrou" 4x seguidas na mesma mensagem,
  // sem nenhuma saída no meio.
  const eventos = [
    { id: '1932', nome: 'baiano dobronx', acao: 'jogador_entrou', ocorrido_em: '2026-09-12T01:41:00Z' },
    { id: '1932', nome: 'baiano dobronx', acao: 'jogador_entrou', ocorrido_em: '2026-09-12T01:41:00Z' },
    { id: '1932', nome: 'baiano dobronx', acao: 'jogador_entrou', ocorrido_em: '2026-09-12T01:41:00Z' },
    { id: '1932', nome: 'baiano dobronx', acao: 'jogador_entrou', ocorrido_em: '2026-09-12T01:41:00Z' },
    { id: '1932', nome: 'baiano dobronx', acao: 'jogador_saiu', ocorrido_em: '2026-09-12T04:48:00Z' },
  ];
  const unificado = P.unificarReconexoesRapidas(eventos, 2 * 60 * 1000);
  const inicio = new Date('2026-09-12T01:00:00Z');
  const fim = new Date('2026-09-12T05:00:00Z');
  const tempo = P.tempoJogadoPorPeriodo([], unificado, inicio, fim);
  // Uma sessão só, do 1º "entrou" até o "saiu" — não 4x o tempo, nem 4
  // sessões separadas.
  assert.equal(tempo.get('1932').ms, new Date('2026-09-12T04:48:00Z') - new Date('2026-09-12T01:41:00Z'));

  const baldes = E.gerarBaldes(inicio, fim, HORA_MS, E.chaveHora, E.inicioDaHoraSP);
  const serie = P.serieDeOcupacao([], unificado, baldes);
  assert.ok(serie.every(b => b.pico <= 1), 'as 4 entradas duplicadas não podem contar 4 jogadores simultâneos');
});

test('saída seguida de entrada no mesmíssimo instante (mesma mensagem) é reconexão, não visita nova', () => {
  // Caso real: "Saída #1260 mgzin rlk" e "Entrada #1260 mgzin rlk" na mesma
  // mensagem (mesmo ocorrido_em) — só existe a ordem certa (saída antes da
  // entrada) porque o SQL agora desempata por embed_indice; sem isso, o
  // Postgres poderia devolver a entrada primeiro, e essa reconexão viraria
  // (errado) uma sessão fechada seguida de uma sessão nova.
  const eventos = [
    { id: '1260', nome: 'mgzin rlk', acao: 'jogador_entrou', ocorrido_em: '2026-09-12T01:49:00Z' },
    { id: '1260', nome: 'mgzin rlk', acao: 'jogador_saiu', ocorrido_em: '2026-09-12T01:49:00Z' },
    { id: '1260', nome: 'mgzin rlk', acao: 'jogador_entrou', ocorrido_em: '2026-09-12T01:49:00Z' },
  ];
  const unificado = P.unificarReconexoesRapidas(eventos, 2 * 60 * 1000);
  // A saída-e-volta no mesmo instante some: sobra só a entrada original.
  assert.deepEqual(unificado.map(e => e.acao), ['jogador_entrou']);
});

test('balde de hora e dia no fuso de São Paulo', () => {
  assert.equal(E.chaveHora('2026-09-11T02:30:00Z'), '2026-09-10 23h');
  assert.equal(E.inicioDaHoraSP('2026-09-11T02:30:00Z').toISOString(), '2026-09-11T02:00:00.000Z');
});
