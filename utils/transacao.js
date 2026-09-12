const db = require('./db');

// Transação com conexão dedicada do pool. Concorrência (vaga, estoque, número de
// rifa) se resolve com trava de linha no banco, nunca com checagem em JavaScript.
async function transacao(fn) {
  const conexao = await db.connect();
  try {
    await conexao.query('BEGIN');
    const resultado = await fn(conexao);
    await conexao.query('COMMIT');
    return resultado;
  } catch (err) {
    await conexao.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    conexao.release();
  }
}

module.exports = { transacao };
