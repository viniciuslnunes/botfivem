// Canal de atualizações: catálogo válido, filtro por módulo ligado, primeira subida sem
// despejar histórico, nada repetido e retomada após falha. Postgres em memória + Discord falso.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_SSL = 'off';
const { instalarBanco } = require('../tools/banco-em-memoria');
const { criarCanal, criarServidor } = require('../tools/discord-falso');

let banco;
let config;
let tema;
let regras;
let publicador;
let catalogo;

test.before(async () => {
  banco = await instalarBanco(); // ANTES de carregar qualquer módulo do bot
  config = require('../config/index.js');
  tema = require('../tema');
  regras = require('../utils/atualizacoes/regras');
  catalogo = require('../utils/atualizacoes/catalogo');
  publicador = require('../utils/atualizacoes/publicador');
});
test.after(async () => { await banco.pglite.close(); });

const entrada = (id, extra = {}) => ({
  id, data: id.slice(0, 10), tipo: 'novo', titulo: 'T', resumo: 'R', itens: ['a'], modulos: [], ...extra,
});

test('catálogo real: toda entrada é válida, cita módulos que existem e os ids não se repetem', () => {
  const manifestos = require('../modulos');
  const conhecidos = new Set(manifestos.map(m => m.id));
  const ignoradas = [];
  const entradas = catalogo.carregar({ modulosConhecidos: conhecidos, log: (...a) => ignoradas.push(a.join(' ')) });
  assert.deepEqual(ignoradas, [], 'nenhuma entrada ignorada');
  assert.ok(entradas.length > 0);
  assert.equal(new Set(entradas.map(e => e.id)).size, entradas.length);
});

test('validação: recusa entrada mal formada', () => {
  const ok = entrada('2026-09-26-x');
  assert.deepEqual(regras.validarEntrada(ok), []);
  for (const [ruim, trecho] of [
    [{ ...ok, tipo: 'outro' }, /tipo inválido/],
    [{ ...ok, id: 'sem-data' }, /id deve ser/],
    [{ ...ok, data: '2026-13-40' }, /data deve ser/],
    [{ ...ok, id: '2026-09-25-x' }, /começar pela data/],
    [{ ...ok, itens: [] }, /itens/],
    [{ ...ok, titulo: 'x'.repeat(101) }, /titulo/],
    [{ ...ok, modulos: ['naoExiste'] }, /não existe/],
  ]) {
    assert.match(regras.validarEntrada(ruim, { modulosConhecidos: new Set(['recrutamento']) }).join(' '), trecho);
  }
});

test('filtro: só o que interessa aos módulos ligados (lista vazia vale para todos)', () => {
  const todos = [entrada('2026-09-20-geral'), entrada('2026-09-21-rec', { modulos: ['recrutamento'] }), entrada('2026-09-22-loja', { modulos: ['loja', 'rifas'] })];
  const ativo = id => id === 'recrutamento';
  assert.deepEqual(regras.doTenant(todos, ativo).map(e => e.id), ['2026-09-20-geral', '2026-09-21-rec']);
});

test('pendentes: primeira vez posta só o recente; depois só o que falta, sempre do mais antigo ao mais novo', () => {
  const agora = new Date('2026-09-26T12:00:00Z');
  const velha = entrada('2026-08-01-velha');
  const recente = entrada('2026-09-25-recente');
  const nova = entrada('2026-09-26-nova');

  const primeira = regras.separarPendentes([nova, velha, recente], null, agora);
  assert.deepEqual(primeira.publicar.map(e => e.id), ['2026-09-25-recente', '2026-09-26-nova']);
  assert.deepEqual(primeira.silenciar.map(e => e.id), ['2026-08-01-velha']);

  const depois = regras.separarPendentes([nova, velha, recente], new Set(['2026-09-25-recente', '2026-08-01-velha']), agora);
  assert.deepEqual(depois.publicar.map(e => e.id), ['2026-09-26-nova']);
  assert.deepEqual(depois.silenciar, []);
});

test('embed: cor do tema por tipo (nunca verde), título com a marca, limites do Discord', () => {
  for (const tipo of Object.keys(regras.TIPOS)) {
    const e = regras.montarEmbed(entrada('2026-09-26-x', { tipo, quem: 'Todos' }), tema);
    assert.equal(e.color, tema.cor[regras.TIPOS[tipo].cor]);
    assert.doesNotMatch(String(e.color), /^(65280|5763719)$/);
    assert.ok(e.title.length <= 256 && e.description.length <= 4096);
    assert.ok(e.fields.every(f => f.value.length <= 1024));
  }
  const regra = regras.montarEmbed(entrada('2026-09-26-x', { tipo: 'regra' }), tema);
  assert.equal(regra.fields[0].name, 'O QUE VALE A PARTIR DE AGORA');
  assert.match(regra.title, new RegExp(tema.marca.nome));
  assert.equal(regras.montarEmbed(entrada('2026-09-26-x'), tema).footer.text, 'Atualização de 26/09/2026');
});

async function limpar() {
  await banco.q("DELETE FROM bot_config WHERE key = 'atualizacoes_postadas'");
}

function servidor() {
  const canal = criarCanal(config.canais.atualizacoes, 'atualizacoes');
  return { canal, guild: criarServidor({ canais: [canal] }) };
}

test('publicador: canal do tenant configurado; primeira subida não despeja histórico e não repete depois', async () => {
  assert.equal(config.canais.atualizacoes, '1442278983847641250');
  await limpar();
  const { canal, guild } = servidor();
  const agora = new Date('2026-09-26T12:00:00Z');
  const entradas = [entrada('2026-08-01-velha'), entrada('2026-09-25-recente'), entrada('2026-09-26-rec', { modulos: ['recrutamento'] }), entrada('2026-09-26-loja', { modulos: ['loja'] })];
  const moduloAtivo = id => id === 'recrutamento';

  const r1 = await publicador.publicarPendentes(guild.client, { moduloAtivo, agora, entradas });
  assert.deepEqual(r1, { postadas: 2, silenciadas: 1 });
  assert.equal(canal.enviadas.length, 2);
  assert.deepEqual(canal.enviadas[0].embeds[0].footer, { text: 'Atualização de 25/09/2026' }, 'da mais antiga para a mais nova');

  const r2 = await publicador.publicarPendentes(guild.client, { moduloAtivo, agora, entradas });
  assert.deepEqual(r2, { postadas: 0, silenciadas: 0 });
  assert.equal(canal.enviadas.length, 2, 'nada repetido');

  // entrega nova depois: só ela sai
  const r3 = await publicador.publicarPendentes(guild.client, { moduloAtivo, agora, entradas: [...entradas, entrada('2026-09-27-nova')] });
  assert.equal(r3.postadas, 1);
  assert.equal(canal.enviadas.length, 3);
  // e uma de módulo desligado nunca sai
  assert.ok(!canal.enviadas.some(m => JSON.stringify(m.embeds).includes('2026-09-26-loja')));
});

test('publicador: se cair no meio, a próxima subida continua de onde parou', async () => {
  await limpar();
  const { canal, guild } = servidor();
  const agora = new Date('2026-09-26T12:00:00Z');
  const entradas = [entrada('2026-09-24-a'), entrada('2026-09-25-b'), entrada('2026-09-26-c')];

  const enviar = canal.send.bind(canal);
  let chamadas = 0;
  canal.send = async payload => {
    if (++chamadas === 2) throw new Error('Discord fora do ar');
    return enviar(payload);
  };
  await assert.rejects(publicador.publicarPendentes(guild.client, { moduloAtivo: () => true, agora, entradas }), /fora do ar/);
  assert.equal(canal.enviadas.length, 1);

  canal.send = enviar;
  const r = await publicador.publicarPendentes(guild.client, { moduloAtivo: () => true, agora, entradas });
  assert.equal(r.postadas, 2, 'só o que faltava');
  assert.equal(canal.enviadas.length, 3);
});

test('publicador: canal não encontrado no Discord não marca nada como postado (tenta de novo na próxima subida)', async () => {
  await limpar();
  const { guild } = servidor();
  const semCanal = { ...guild.client, channels: { fetch: async () => null } };
  const r = await publicador.publicarPendentes(semCanal, {
    moduloAtivo: () => true, entradas: [entrada('2026-09-26-x')], agora: new Date('2026-09-26T12:00:00Z'),
  });
  assert.equal(r.postadas, 0);
  assert.equal((await banco.q("SELECT count(*)::int AS n FROM bot_config WHERE key = 'atualizacoes_postadas'"))[0].n, 0);
});
