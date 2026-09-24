// Postgres real em memória (PGlite) no lugar de utils/db.js, com as migrações do
// bot aplicadas — para exercitar fluxos inteiros sem tocar o banco de verdade.
//
//   const { instalarBanco } = require('../tools/banco-em-memoria');
//   const banco = await instalarBanco();   // ANTES de carregar qualquer módulo do bot
//   await banco.q('SELECT …');
//
// TRAVA (incidente de 2026-09-13): se a substituição de utils/db.js não pegar,
// aborta em vez de seguir para o banco real.
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const RAIZ = path.join(__dirname, '..');

async function instalarBanco({ migrar = true } = {}) {
  const pglite = new PGlite();
  const parsers = { 20: v => v, 1700: v => v }; // int8 e numeric como texto, igual ao driver pg

  let fila = Promise.resolve();
  const exclusivo = fn => {
    const p = fila.then(fn);
    fila = p.catch(() => {});
    return p;
  };
  const consultar = (texto, params) => pglite.query(texto, params ?? [], { parsers })
    .then(r => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }));
  const pool = {
    query: (t, p) => exclusivo(() => consultar(t, p)),
    connect: () => new Promise(entregar => {
      exclusivo(() => new Promise(liberar => entregar({ query: consultar, release: liberar })));
    }),
    on() {},
    end: async () => {},
  };

  process.env.DATABASE_URL = 'postgres://memoria:memoria@127.0.0.1:1/memoria';
  const caminho = require.resolve(path.join(RAIZ, 'utils', 'db.js'));
  require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports: pool };
  if (require(path.join(RAIZ, 'utils', 'db.js')) !== pool) {
    throw new Error('[banco-em-memoria] Substituição de utils/db.js falhou — abortando para não escrever no banco real.');
  }

  if (migrar) {
    const { executarMigracoes } = require(path.join(RAIZ, 'utils', 'migracoes.js'));
    const erros = [];
    const original = console.error;
    console.error = (...a) => erros.push(a.join(' '));
    try { await executarMigracoes(); } finally { console.error = original; }
    if (erros.length) throw new Error(`migrações falharam: ${erros.join('; ')}`);
  }

  return { pool, pglite, q: async (sql, params) => (await pool.query(sql, params)).rows };
}

module.exports = { instalarBanco };
