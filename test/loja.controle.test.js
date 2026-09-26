// Banco de controle da loja (docs/loja/schema-controle.sql), heartbeat do bot e
// catálogo. Tudo em PGlite/funções puras: nunca toca banco real nem Discord.
process.env.DATABASE_URL = 'postgres://teste:teste@127.0.0.1:1/teste';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { montarBatida, lerConfig, enviarBatida } = require('../plataforma/heartbeat');
const { catalogoDeModulos, catalogoDeTorcidas, modulosLigados } = require('../plataforma/catalogo');
const manifestos = require('../modulos');

test('schema de controle: situação de plano e de bot pela view', async () => {
  const db = new PGlite();
  await db.exec(fs.readFileSync(path.join(__dirname, '..', 'docs', 'loja', 'schema-controle.sql'), 'utf8'));
  await db.exec("INSERT INTO planos (id, nome, preco_centavos, modulos) VALUES ('completo', 'Completo', 9900, '{eventos}')");
  const guild = n => `1000000000000000${String(n).padStart(2, '0')}`;
  for (const [i, slug] of ['vigente', 'carencia', 'vencida', 'semplano', 'parada', 'nunca'].entries()) {
    await db.query('INSERT INTO torcidas (slug, nome, guild_id) VALUES ($1, $1, $2)', [slug, guild(i)]);
    await db.query("INSERT INTO instancias (torcida_id, segredo_ref, token_batida_hash) VALUES ((SELECT id FROM torcidas WHERE slug = $1), 'cofre/x', 'h')", [slug]);
  }
  const assina = (slug, dias) => db.query(
    "INSERT INTO assinaturas (torcida_id, plano_id, inicio, vigente_ate) VALUES ((SELECT id FROM torcidas WHERE slug = $1), 'completo', CURRENT_DATE - 60, CURRENT_DATE + $2::int)", [slug, dias]);
  await assina('vigente', 10); await assina('carencia', -2); await assina('vencida', -30); await assina('parada', 10); await assina('nunca', 10);
  const bate = (slug, minutos, status) => db.query(
    "INSERT INTO batida_atual (torcida_id, recebida_em, status) VALUES ((SELECT id FROM torcidas WHERE slug = $1), now() - $2::int * INTERVAL '1 minute', $3)", [slug, minutos, status]);
  await bate('vigente', 0, 'ok'); await bate('carencia', 0, 'degradado'); await bate('vencida', 0, 'ok'); await bate('parada', 10, 'ok');

  const { rows } = await db.query('SELECT slug, plano_situacao, bot_situacao FROM torcidas_status ORDER BY slug');
  const por = Object.fromEntries(rows.map(r => [r.slug, r]));
  assert.deepEqual([por.vigente.plano_situacao, por.vigente.bot_situacao], ['vigente', 'no_ar']);
  assert.deepEqual([por.carencia.plano_situacao, por.carencia.bot_situacao], ['carencia', 'degradado']);
  assert.deepEqual([por.vencida.plano_situacao, por.vencida.bot_situacao], ['vencido', 'no_ar']);
  assert.equal(por.semplano.plano_situacao, 'sem_plano');
  assert.equal(por.parada.bot_situacao, 'parado'); // 10 min sem batida com intervalo de 60 s
  assert.equal(por.nunca.bot_situacao, 'nunca');

  await assert.rejects(() => db.query("INSERT INTO torcidas (slug, nome, guild_id) VALUES ('ruim', 'x', '123')"), /check/i);
  await db.close();
});

test('heartbeat: config exige token, intervalo mínimo; sem URL é desligado', () => {
  assert.equal(lerConfig({}), null);
  assert.throws(() => lerConfig({ CONTROLE_URL: 'nao e url', CONTROLE_TOKEN: 'x' }), /CONTROLE_URL inválida/);
  assert.throws(() => lerConfig({ CONTROLE_URL: 'https://loja.exemplo/batida' }), /sem CONTROLE_TOKEN/);
  assert.throws(() => lerConfig({ CONTROLE_URL: 'https://loja.exemplo/batida', CONTROLE_TOKEN: 't', CONTROLE_INTERVALO_SEG: '2' }), /mínimo 10/);
  assert.equal(lerConfig({ CONTROLE_URL: 'https://loja.exemplo/batida', CONTROLE_TOKEN: 't' }).intervaloMs, 60000);
});

test('heartbeat: a batida não leva segredo e a falha da loja nunca lança', async () => {
  const batida = montarBatida({
    saude: { status: 'ok', modoInstalacao: false, uptimeSeg: 5, discord: { pronto: true }, banco: { ok: true } },
    tenant: { slug: 'x', guildId: '100000000000000001', canais: { segredo: '999' } },
    plataforma: { ativos: [{ id: 'eventos' }] },
    versao: '1.0.0',
  });
  assert.deepEqual(Object.keys(batida).sort(), ['bancoOk', 'discordPronto', 'emitidaEm', 'guildId', 'modoInstalacao', 'modulos', 'slug', 'status', 'uptimeSeg', 'versao']);
  assert.ok(!JSON.stringify(batida).includes('999'));

  const chamadas = [];
  const config = { url: 'https://loja.exemplo/batida', token: 'seg' };
  const ok = await enviarBatida({ config, batida, fetchFn: async (url, opt) => { chamadas.push({ url, opt }); return { ok: true, status: 200 }; } });
  assert.deepEqual(ok, { ok: true, status: 200 });
  assert.equal(chamadas[0].opt.headers.Authorization, 'Bearer seg');
  const falha = await enviarBatida({ config, batida, fetchFn: async () => { throw new Error('ECONNREFUSED'); } });
  assert.deepEqual(falha, { ok: false, erro: 'ECONNREFUSED' });
});

test('catálogo: módulos descrevem o produto; torcidas saem sem ID nem caminho; molde é ignorado', () => {
  const mods = catalogoDeModulos(manifestos);
  assert.ok(mods.length >= 20 && mods.every(m => m.id && m.descricao));
  const torcidas = catalogoDeTorcidas(path.join(__dirname, '..', 'tenants'), manifestos);
  assert.ok(!torcidas.some(t => t.slug.startsWith('_')));
  const gav = torcidas.find(t => t.slug === 'gavioes');
  assert.ok(gav && !gav.erro, gav?.erro);
  assert.deepEqual(gav.proibido.matizes, ['verde']);
  assert.ok(gav.modulos.includes('nucleo'));
  assert.ok(!/\d{17,20}/.test(JSON.stringify(gav)), 'catálogo não expõe ID de Discord');
  assert.ok(!JSON.stringify(gav).includes('assets'));
  assert.ok(modulosLigados(manifestos, { modulos: { rifas: false } }).every(id => id !== 'rifas'));
});
