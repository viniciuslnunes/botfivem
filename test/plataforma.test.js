const test = require('node:test');
const assert = require('node:assert/strict');
const { validarManifesto } = require('../plataforma/contrato');
const { resolverModulos } = require('../plataforma/resolver');
const { executarEmSequencia, executarAteConsumir, dispararSemEsperar } = require('../plataforma/executar');

const mod = (id, extra = {}) => ({ id, descricao: `módulo ${id}`, padrao: true, ...extra });
const tenant = (extra = {}) => ({ canais: { a: '1' }, cargos: { x: '2', lista: ['3'] }, categorias: {}, links: {}, ...extra });
const tema = { marca: { elenco: { logo: 'e.png' } } };

test('contrato: manifesto mínimo é válido', () => {
  assert.deepEqual(validarManifesto(mod('rifas')), []);
});

test('contrato: lista todos os erros de forma de uma vez', () => {
  const erros = validarManifesto({
    id: 'Rifas', padrao: 'sim', requer: 'x', comandos: [1], exige: { canais: 'a', banana: [] },
    carregar: 'nao', aoMensagem: 5, painelLog: {}, aoMesnagem() {},
  }, 'm');
  for (const trecho of ['id inválido', 'descricao', 'padrao', 'requer', 'comandos', 'exige.canais', 'exige.banana', 'carregar', 'aoMensagem', 'painelLog.iniciar', 'aoMesnagem']) {
    assert.ok(erros.some(e => e.includes(trecho)), `deveria citar ${trecho}:\n${erros.join('\n')}`);
  }
});

test('contrato: módulo obrigatório precisa de padrao true', () => {
  assert.ok(validarManifesto(mod('nucleo', { obrigatorio: true, padrao: false })).some(e => e.includes('obrigatório precisa')));
});

test('resolver: padrao decide quando o tenant não fala; tenant.modulos sobrepõe', () => {
  const ms = [mod('a'), mod('b', { padrao: false }), mod('c')];
  const r = resolverModulos(ms, { tenant: tenant({ modulos: { b: true, c: false } }), tema });
  assert.deepEqual(r.erros, []);
  assert.deepEqual(r.ativos.map(m => m.id), ['a', 'b']);
  assert.deepEqual(r.desligados.map(m => m.id), ['c']);
});

test('resolver: preserva a ordem do manifesto', () => {
  const r = resolverModulos([mod('z'), mod('a'), mod('m')], { tenant: tenant(), tema });
  assert.deepEqual(r.ativos.map(m => m.id), ['z', 'a', 'm']);
});

test('resolver: id repetido, id desconhecido no tenant e valor não booleano', () => {
  const r = resolverModulos([mod('a'), mod('a')], { tenant: tenant({ modulos: { fantasma: true, a: 'sim' } }), tema });
  assert.ok(r.erros.some(e => e.includes('declarado duas vezes')));
  assert.ok(r.erros.some(e => e.includes('desconhecido "fantasma"')));
  assert.ok(r.erros.some(e => e.includes('esperado true/false')));
});

test('resolver: módulo obrigatório não pode ser desligado', () => {
  const r = resolverModulos([mod('nucleo', { obrigatorio: true })], { tenant: tenant({ modulos: { nucleo: false } }), tema });
  assert.ok(r.erros.some(e => e.includes('obrigatório não pode ser desligado')));
  assert.equal(r.ativos.length, 1);
});

test('resolver: dependência desligada ou inexistente é erro claro dos dois lados', () => {
  const ms = [mod('fin'), mod('rifas', { requer: ['fin', 'nada'] })];
  const r = resolverModulos(ms, { tenant: tenant({ modulos: { fin: false } }), tema });
  assert.ok(r.erros.some(e => e.includes('"rifas" requer "fin", que está desligado — ligue "fin" ou desligue "rifas"')));
  assert.ok(r.erros.some(e => e.includes('"rifas" requer "nada", que não existe')));
});

test('resolver: dependência desligada não incomoda quem também está desligado', () => {
  const ms = [mod('fin'), mod('rifas', { requer: ['fin'] })];
  const r = resolverModulos(ms, { tenant: tenant({ modulos: { fin: false, rifas: false } }), tema });
  assert.deepEqual(r.erros, []);
});

test('resolver: exige do tenant (canal, cargo, lista não vazia) e da marca', () => {
  const ms = [mod('a', { exige: { canais: ['a', 'falta'], cargos: ['x', 'lista', 'vazio'], marca: ['elenco.logo', 'elenco.titulo'] } })];
  const r = resolverModulos(ms, { tenant: tenant({ cargos: { x: '2', lista: ['3'], vazio: [] } }), tema });
  const msg = r.erros.join('\n');
  assert.ok(msg.includes('canais.falta'));
  assert.ok(msg.includes('cargos.vazio'));
  assert.ok(msg.includes('marca.elenco.titulo'));
  assert.ok(!msg.includes('canais.a,') && !msg.includes('cargos.x') && !msg.includes('marca.elenco.logo'));
});

test('resolver: exige.tenant checa chave de primeiro nível (lista vazia conta como faltando)', () => {
  const ms = [mod('a', { exige: { tenant: ['parceiros', 'outra'] } })];
  const r = resolverModulos(ms, { tenant: tenant({ parceiros: [], outra: [{ label: 'x' }] }), tema });
  const texto = r.erros.join(' | ');
  assert.ok(texto.includes('parceiros'));
  assert.ok(!texto.includes('outra'));
});

test('resolver: exige não é cobrada de módulo desligado', () => {
  const r = resolverModulos([mod('a', { padrao: false, exige: { canais: ['falta'] } })], { tenant: tenant(), tema });
  assert.deepEqual(r.erros, []);
});

test('executar: erro de um módulo não derruba os outros e é logado com o nome', async () => {
  const chamadas = [];
  const logs = [];
  const ms = [
    { id: 'a', aoIniciar: () => chamadas.push('a') },
    { id: 'b', aoIniciar: () => { throw new Error('boom'); } },
    { id: 'c', aoIniciar: async () => { chamadas.push('c'); } },
    { id: 'd' }, // sem o hook
  ];
  await executarEmSequencia(ms, 'aoIniciar', [], { log: (...a) => logs.push(a) });
  assert.deepEqual(chamadas, ['a', 'c']);
  assert.equal(logs.length, 1);
  assert.match(logs[0][0], /\[b:aoIniciar\]/);
});

test('executar: espera cada hook terminar, na ordem', async () => {
  const ordem = [];
  const ms = [
    { id: 'lento', aoMensagem: async () => { await new Promise(r => setTimeout(r, 20)); ordem.push('lento'); } },
    { id: 'rapido', aoMensagem: () => { ordem.push('rapido'); } },
  ];
  await executarEmSequencia(ms, 'aoMensagem', []);
  assert.deepEqual(ordem, ['lento', 'rapido']);
});

test('executar: aoMensagem para no primeiro que consome (true) e ignora truthy que não é true', async () => {
  const vistos = [];
  const ms = [
    { id: 'a', aoMensagem: () => { vistos.push('a'); return 'talvez'; } },
    { id: 'b', aoMensagem: () => { vistos.push('b'); return true; } },
    { id: 'c', aoMensagem: () => { vistos.push('c'); return true; } },
  ];
  assert.equal(await executarAteConsumir(ms, 'aoMensagem', []), true);
  assert.deepEqual(vistos, ['a', 'b']);
  assert.equal(await executarAteConsumir([{ id: 'x', aoMensagem: () => false }], 'aoMensagem', []), false);
});

test('executar: erro no hook que consome não consome; a cadeia continua', async () => {
  const logs = [];
  const ms = [
    { id: 'a', aoMensagem: () => { throw new Error('x'); } },
    { id: 'b', aoMensagem: () => true },
  ];
  assert.equal(await executarAteConsumir(ms, 'aoMensagem', [], { log: (...a) => logs.push(a) }), true);
  assert.equal(logs.length, 1);
});

test('executar: dispararSemEsperar não bloqueia no lento, mas loga rejeição e erro síncrono', async () => {
  const logs = [];
  let terminou = false;
  const ms = [
    { id: 'lento', aoIniciar: () => new Promise(r => setTimeout(() => { terminou = true; r(); }, 30)) },
    { id: 'rejeita', aoIniciar: () => Promise.reject(new Error('r')) },
    { id: 'lanca', aoIniciar: () => { throw new Error('s'); } },
  ];
  dispararSemEsperar(ms, 'aoIniciar', [], { log: (...a) => logs.push(a[0]) });
  assert.equal(terminou, false); // retornou antes do lento acabar
  await new Promise(r => setTimeout(r, 50));
  assert.equal(terminou, true);
  assert.ok(logs.some(l => l.includes('[rejeita:aoIniciar]')));
  assert.ok(logs.some(l => l.includes('[lanca:aoIniciar]')));
});

test('executar: o contexto chega como ÚLTIMO argumento de cada hook', async () => {
  const vistos = [];
  const ms = [{ id: 'a', aoMembroAtualizado: (antes, depois, ctx) => vistos.push([antes, depois, ctx]) }];
  const contexto = { marca: 'ctx' };
  await executarEmSequencia(ms, 'aoMembroAtualizado', ['A', 'D'], { contexto });
  assert.deepEqual(vistos, [['A', 'D', contexto]]);
});
