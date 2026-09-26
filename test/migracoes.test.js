// Migrações por módulo, contra Postgres real em memória (PGlite). Prova que:
//  • um banco VAZIO (torcida nova) fica completo — antes faltavam socios,
//    bot_config e aprovacoes_recrutamento, criadas à mão em produção;
//  • cada módulo, com suas dependências, migra sem erro (FKs entre módulos);
//  • toda tabela que o código consulta existe e pertence a um módulo coerente.
// Nada aqui toca o banco real: só strings de SQL rodam no PGlite.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

// Nenhuma query do bot roda aqui, mas o require de utils/migracoes cria o Pool:
// garante que ele nunca aponte para o banco real.
process.env.DATABASE_URL = 'postgres://teste:teste@127.0.0.1:1/teste';
const dbPath = require.resolve('../utils/db.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => { throw new Error('teste tocou no banco'); } } };

const { MIGRACOES, migracoesDosModulos } = require('../utils/migracoes');
const manifestos = require('../modulos');

const RAIZ = path.join(__dirname, '..');
const idsDosModulos = new Set(manifestos.map(m => m.id));

// fecho transitivo de `requer` (o que precisa estar ligado junto)
function fecho(id, vistos = new Set()) {
  if (vistos.has(id)) return vistos;
  vistos.add(id);
  for (const dep of manifestos.find(m => m.id === id).requer || []) fecho(dep, vistos);
  return vistos;
}

let contadorSchema = 0;
const compartilhado = new PGlite();

// Cada chamada usa um schema novo (e o descarta), então dá para reaproveitar uma
// única instância do PGlite sem que um cenário enxergue tabelas do outro.
async function migrar(ids) {
  const schema = `cenario_${++contadorSchema}`;
  await compartilhado.exec(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}`);
  const falhas = [];
  for (const m of migracoesDosModulos(ids)) {
    try { await compartilhado.exec(m.sql); } catch (err) { falhas.push(`${m.nome}: ${err.message}`); }
  }
  const { rows } = await compartilhado.query('SELECT table_name FROM information_schema.tables WHERE table_schema = $1', [schema]);
  await compartilhado.exec(`SET search_path TO public; DROP SCHEMA ${schema} CASCADE`);
  return { falhas, tabelas: new Set(rows.map(r => r.table_name)) };
}

test('toda migração declara o módulo dono, e o dono existe', () => {
  for (const m of MIGRACOES) {
    assert.ok(m.modulo === 'nucleo' || idsDosModulos.has(m.modulo), `${m.nome}: módulo "${m.modulo}" não existe`);
    assert.ok(typeof m.sql === 'string' && m.sql.trim(), `${m.nome}: sem sql`);
  }
  const nomes = MIGRACOES.map(m => m.nome);
  assert.equal(new Set(nomes).size, nomes.length, 'nome de migração repetido');
});

test('banco vazio + todas as migrações: sobe sem falha e cria as 3 tabelas que antes eram manuais', async () => {
  const { falhas, tabelas } = await migrar(undefined);
  assert.deepEqual(falhas, []);
  for (const t of ['socios', 'bot_config', 'aprovacoes_recrutamento', 'logs_jogo', 'eventos', 'rifas', 'departamentos', 'tarefas_agendadas']) {
    assert.ok(tabelas.has(t), `faltou a tabela ${t}`);
  }
});

test('idempotente: rodar duas vezes no mesmo banco não falha (é o que acontece a cada start)', async () => {
  const pg = new PGlite();
  const falhas = [];
  for (let rodada = 0; rodada < 2; rodada++) {
    for (const m of MIGRACOES) {
      try { await pg.exec(m.sql); } catch (err) { falhas.push(`${m.nome}: ${err.message}`); }
    }
  }
  await pg.close();
  assert.deepEqual(falhas, []);
});

test('cada módulo, ligado com suas dependências, migra sem erro (nenhum FK cruza módulo desligado)', async () => {
  for (const m of manifestos) {
    const ids = fecho(m.id);
    const { falhas } = await migrar(ids);
    assert.deepEqual(falhas, [], `módulo ${m.id} (com ${[...ids].join(', ')})`);
  }
});

test('módulo desligado não cria as tabelas dele', async () => {
  const semRifas = new Set(manifestos.map(m => m.id).filter(id => !['rifas', 'painelFarm'].includes(id)));
  const { falhas, tabelas } = await migrar(semRifas);
  assert.deepEqual(falhas, []);
  for (const t of ['rifas', 'rifa_compras', 'rifa_bilhetes']) assert.ok(!tabelas.has(t), `${t} não deveria existir`);
  assert.ok(tabelas.has('eventos') && tabelas.has('bot_config')); // o resto ficou
});

// ── Toda tabela que o código consulta existe ─────────────────────────────────
function arquivosJs(dir) {
  const abs = path.join(RAIZ, dir);
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap(e => {
    const rel = path.posix.join(dir, e.name);
    return e.isDirectory() ? arquivosJs(rel) : e.name.endsWith('.js') ? [rel] : [];
  });
}

// Nomes que aparecem depois de FROM/JOIN mas não são tabelas
const NAO_TABELA = new Set(['novatos', 'etapas', 'unnest']); // CTEs e função do Postgres

test('toda tabela usada em SQL no código existe depois das migrações', async () => {
  const usadas = new Map(); // tabela -> arquivos
  for (const arq of [...arquivosJs('utils'), ...arquivosJs('commands')]) {
    if (arq === 'utils/migracoes.js') continue;
    const src = fs.readFileSync(path.join(RAIZ, arq), 'utf8');
    for (const m of src.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z][a-z_]{3,})\b/g)) {
      if (NAO_TABELA.has(m[1])) continue;
      if (!usadas.has(m[1])) usadas.set(m[1], new Set());
      usadas.get(m[1]).add(arq);
    }
  }
  const { tabelas } = await migrar(undefined);
  const faltando = [...usadas.keys()].filter(t => !tabelas.has(t));
  assert.deepEqual(faltando, [], `tabelas usadas e não criadas: ${faltando.map(t => `${t} (${[...usadas.get(t)].slice(0, 2).join(', ')})`).join('; ')}`);
});

// ── Dono da tabela coerente com quem a usa ───────────────────────────────────
// Arquivo → módulo, para checar que quem consulta uma tabela declara (por
// `requer`) o módulo que a cria.
const DIR_PARA_MODULO = {
  departamentos: 'departamentos', logsJogo: 'logsJogo', recrutamento: 'recrutamento', eventos: 'eventos',
  caravana: 'caravana', escala: 'escala', financeiro: 'financeiro', loja: 'loja', patrimonio: 'patrimonio',
  rifas: 'rifas', confianca: 'confianca', memoria: 'memoria', carteirinha: 'carteirinha', advertencia: 'advertencia',
  advertenciaRecrutador: 'advertenciaRecrutador', advertenciaRecrutadorAuto: 'advertenciaRecrutadorAuto', merito: 'meritoRecrutadores', antiSpam: 'antiSpam', sugestoes: 'sugestoes', inteligencia: 'inteligencia', sorteios: 'sorteios',
};
const ARQUIVO_PARA_MODULO = {
  'utils/carteirinhaSocio.js': 'carteirinha', 'utils/carteirinhaInteracoes.js': 'carteirinha', 'utils/muralAssociados.js': 'carteirinha',
  'utils/topRecrutadores.js': 'recrutamento', 'utils/quadroRecrutadores.js': 'recrutamento',
  'utils/agendador.js': 'nucleo', 'utils/botConfig.js': 'nucleo', 'utils/tarefas.js': 'nucleo',
};

function moduloDoArquivo(arq) {
  if (ARQUIVO_PARA_MODULO[arq]) return ARQUIVO_PARA_MODULO[arq];
  const p = arq.split('/');
  if (p[0] === 'commands') {
    const dono = manifestos.find(m => (m.comandos || []).includes(p[1].replace(/\.js$/, '')));
    return dono?.id;
  }
  return p.length > 2 ? DIR_PARA_MODULO[p[1]] : undefined;
}

test('quem consulta uma tabela depende (requer) do módulo que a cria', () => {
  const donoDaTabela = new Map();
  for (const m of MIGRACOES) {
    for (const t of m.sql.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)) donoDaTabela.set(t[1], m.modulo);
  }
  const problemas = [];
  for (const arq of [...arquivosJs('utils'), ...arquivosJs('commands')]) {
    const modulo = moduloDoArquivo(arq);
    if (!modulo || modulo === 'nucleo') continue;
    const src = fs.readFileSync(path.join(RAIZ, arq), 'utf8');
    const permitidos = fecho(modulo);
    permitidos.add('nucleo');
    for (const m of src.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z][a-z_]{3,})\b/g)) {
      const dono = donoDaTabela.get(m[1]);
      if (dono && !permitidos.has(dono)) problemas.push(`${arq} (módulo ${modulo}) usa ${m[1]}, dono: ${dono}`);
    }
  }
  assert.deepEqual([...new Set(problemas)], []);
});
