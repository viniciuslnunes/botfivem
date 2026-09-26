const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../utils/sorteios/regras');

test('escolherNumero: nunca repete e esgota o intervalo', () => {
  const saiu = [];
  for (let i = 0; i < 15; i++) saiu.push(R.escolherNumero(15, saiu));
  assert.equal(new Set(saiu).size, 15);
  assert.ok(saiu.every(n => n >= 1 && n <= 15));
  assert.equal(R.escolherNumero(15, saiu), null);
});

test('escolherNumero: só sorteia entre os restantes (rand injetado)', () => {
  assert.equal(R.escolherNumero(5, [1, 2, 4], () => 0), 3);
  assert.equal(R.escolherNumero(5, [1, 2, 4], () => 1), 5);
});

test('escolherNumero: distribuição cobre todos os números (sem viés grosseiro)', () => {
  const contagem = new Map();
  for (let i = 0; i < 6000; i++) {
    const n = R.escolherNumero(6, []);
    contagem.set(n, (contagem.get(n) ?? 0) + 1);
  }
  assert.equal(contagem.size, 6);
  for (const v of contagem.values()) assert.ok(v > 800 && v < 1200, `contagem ${v}`);
});

test('parseDia: formatos aceitos, hoje em Brasília e datas impossíveis', () => {
  const agora = new Date('2026-09-27T01:00:00Z'); // ainda 26/09 em Brasília
  assert.equal(R.parseDia('', agora), '2026-09-26');
  assert.equal(R.parseDia('2026-09-20', agora), '2026-09-20');
  assert.equal(R.parseDia('20/09', agora), '2026-09-20');
  assert.equal(R.parseDia('5/1/2025', agora), '2025-01-05');
  assert.equal(R.parseDia('31/02', agora), null);
  assert.equal(R.parseDia('ontem', agora), null);
});

test('parsePremios: uma linha por prêmio, sem marcadores nem linhas vazias', () => {
  assert.deepEqual(R.parsePremios('- Soco inglês\n\n2) Moto\n• 100k').premios, ['Soco inglês', 'Moto', '100k']);
  assert.equal(R.parsePremios('x'.repeat(101)).ok, false);
});

test('parseNumeros e validarTitulo', () => {
  assert.deepEqual(R.parseNumeros(''), { ok: true, numeros: null });
  assert.equal(R.parseNumeros('40').numeros, 40);
  assert.equal(R.parseNumeros('0').ok, false);
  assert.equal(R.parseNumeros('abc').ok, false);
  assert.equal(R.validarTitulo('   ').ok, false);
  assert.equal(R.validarTitulo(' Pista   de sábado ').titulo, 'Pista de sábado');
});

test('numerarParticipantes: distintos por ID, 1..N em ordem alfabética estável', () => {
  const r = R.numerarParticipantes([
    { id: '20', nome: 'Zeca' }, { id: '10', nome: 'ana' }, { id: '20', nome: 'Zeca (dup)' }, { id: '30', nome: 'Bruno' },
  ]);
  assert.deepEqual(r.map(p => [p.numero, p.id]), [[1, '10'], [2, '30'], [3, '20']]);
});

const MIN = 60 * 1000;
const ENTRADAS = [
  { id: '1', nome: 'Ana', ms: 90 * MIN }, { id: '2', nome: 'Bia', ms: 10 * MIN }, { id: '3', nome: 'Caio', ms: 50 * MIN },
  { id: '4', nome: 'Dani', ms: 70 * MIN }, { id: '3', nome: 'Caio', ms: 5 * MIN },
];

test('filtrarElegiveis: mínimo de minutos usa o maior tempo do jogador e renumera sem buraco', () => {
  const r = R.filtrarElegiveis(ENTRADAS, { minMinutos: 30 });
  assert.deepEqual(r.elegiveis.map(p => [p.numero, p.id]), [[1, '1'], [2, '3'], [3, '4']]);
  assert.equal(r.excluidosMinimo, 1);
  assert.equal(r.excluidosRecentes, 0);
});

test('filtrarElegiveis: ganhador recente sai por ID, por Discord ou por nome (o ID troca por season)', () => {
  const ganhadoresRecentes = { ids: new Set(['1']), discords: new Set(['d4']), nomes: new Set(['caio']) };
  const r = R.filtrarElegiveis(ENTRADAS, {
    ganhadoresRecentes, discordPorId: new Map([['4', 'd4']]), normalizar: x => String(x).toLowerCase(),
  });
  assert.deepEqual(r.elegiveis.map(p => p.id), ['2']);
  assert.equal(r.excluidosRecentes, 3);
});

test('hashLista: mesmo conteúdo, mesmo selo; qualquer mudança troca o selo', () => {
  const a = R.numerarParticipantes(ENTRADAS);
  assert.equal(R.hashLista(a), R.hashLista(R.numerarParticipantes([...ENTRADAS].reverse())));
  assert.notEqual(R.hashLista(a), R.hashLista(a.slice(1)));
  assert.match(R.hashLista(a), /^[0-9a-f]{64}$/);
});

test('parseMinutos', () => {
  assert.deepEqual(R.parseMinutos(''), { ok: true, minutos: null });
  assert.equal(R.parseMinutos('45').minutos, 45);
  assert.equal(R.parseMinutos('0').ok, false);
  assert.equal(R.parseMinutos('1441').ok, false);
  assert.equal(R.parseMinutos('x').ok, false);
});
