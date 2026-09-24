const { Pool } = require('pg');
require('dotenv').config({ quiet: true });
const { opcoesDoPool } = require('./dbConfig');

const { opcoes, avisos } = opcoesDoPool(process.env);
for (const aviso of avisos) console.warn(`[db] ${aviso}`);

const pool = new Pool(opcoes);

// Sem este handler, um erro numa conexão ociosa (queda de rede, reinício do
// Postgres) é um 'error' sem ouvinte e derruba o processo inteiro.
pool.on('error', err => {
  console.error('[db] Erro numa conexão ociosa do pool (será recriada):', err.message);
});

module.exports = pool;
