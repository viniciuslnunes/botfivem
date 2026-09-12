const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../utils/logsJogo/estatisticas');

test('dia civil é o de São Paulo, não o UTC', () => {
  assert.equal(E.chaveDia('2026-09-11T02:00:00Z'), '2026-09-10');
  assert.equal(E.inicioDoDiaSP('2026-09-11T02:00:00Z').toISOString(), '2026-09-10T03:00:00.000Z');
});

test('período de 7 dias e janela anterior de mesma duração', () => {
  const agora = new Date('2026-09-11T15:00:00Z');
  const p = E.resolverPeriodo('7d', agora);
  assert.equal(p.inicio.toISOString(), '2026-09-05T03:00:00.000Z');
  assert.equal(p.fim.getTime() - p.inicio.getTime(), p.anteriorFim.getTime() - p.anteriorInicio.getTime());
  assert.equal(p.anteriorFim.getTime(), p.inicio.getTime() + (agora.getTime() - p.inicio.getTime()) - 7 * 86400000);
});

test('períodos civis fechados: ontem, semana passada e mês passado', () => {
  const agora = new Date('2026-09-11T15:00:00Z'); // sexta, 12h em SP

  const ontem = E.resolverPeriodo('ontem', agora);
  assert.equal(ontem.inicio.toISOString(), '2026-09-10T03:00:00.000Z');
  assert.equal(ontem.fim.toISOString(), '2026-09-11T03:00:00.000Z');

  const semana = E.resolverPeriodo('semana_passada', agora);
  const semanaAtual = E.resolverPeriodo('7d', agora);
  assert.equal(semana.inicio.getTime(), semanaAtual.anteriorInicio.getTime());
  assert.equal(semana.fim.getTime(), semanaAtual.anteriorFim.getTime());
  assert.ok(semana.fim.getTime() <= semanaAtual.inicio.getTime(), 'semana passada não pode se sobrepor à semana atual');

  const mes = E.resolverPeriodo('mes_passado', agora);
  const mesAtual = E.resolverPeriodo('30d', agora);
  assert.equal(mes.inicio.getTime(), mesAtual.anteriorInicio.getTime());
  assert.equal(mes.fim.getTime(), mesAtual.anteriorFim.getTime());
});

test('período inválido cai em 7 dias; "tudo" não tem janela anterior', () => {
  assert.equal(E.resolverPeriodo('xyz').chave, '7d');
  const tudo = E.resolverPeriodo('tudo');
  assert.equal(tudo.inicio, null);
  assert.equal(tudo.anteriorInicio, null);
});

test('série diária preenche dias sem registro com zero', () => {
  const serie = E.serieDiaria(
    [{ dia: '2026-09-08', total: 3 }, { dia: '2026-09-10', total: 1 }],
    new Date('2026-09-08T12:00:00Z'),
    new Date('2026-09-10T12:00:00Z')
  );
  assert.deepEqual(serie, [
    { dia: '2026-09-08', total: 3 },
    { dia: '2026-09-09', total: 0 },
    { dia: '2026-09-10', total: 1 },
  ]);
});

test('sparkline escala pelo máximo e não inventa barra em zero', () => {
  assert.equal(E.sparkline([0, 0, 0]), '▁▁▁');
  assert.equal(E.sparkline([0, 7]), '▁█');
  assert.equal(E.sparkline(new Array(90).fill(1)).length, 30);
});

test('duração formatada em minutos, horas e dias', () => {
  assert.equal(E.formatarDuracao(45 * 60000), '45min');
  assert.equal(E.formatarDuracao(3 * 3600000 + 20 * 60000), '3h20min');
  assert.equal(E.formatarDuracao(4 * 3600000), '4h');
  assert.equal(E.formatarDuracao(2 * 86400000 + 5 * 3600000), '2d5h');
  assert.equal(E.formatarDuracao(3 * 86400000), '3d');
});

test('variação contra o período anterior', () => {
  assert.equal(E.variacao(12, 10), '▲ 20% vs período anterior');
  assert.equal(E.variacao(5, 10), '▼ 50% vs período anterior');
  assert.equal(E.variacao(0, 0), '= igual ao período anterior');
  assert.equal(E.variacao(3, 0), '▲ período anterior sem registros');
  assert.equal(E.variacao(3, null), null);
});

test('ID FiveM do apelido padrão do recrutamento', () => {
  assert.equal(E.idFivemDoNick('S GDF | Rarin - 8914'), '8914');
  assert.equal(E.idFivemDoNick('S GDF | Nome Composto -8914 '), '8914');
  assert.equal(E.idFivemDoNick('Visitante'), null);
  assert.equal(E.idFivemDoNick(undefined), null);
});
