const db = require('../db');

// Rifas: margem das já sorteadas (arrecadado - custo do prêmio) e as abertas que podem não fechar
async function panorama() {
  const [sorteadas, emRisco] = await Promise.all([
    db.query(
      `SELECT id, titulo, arrecadado::float AS arrecadado, custo_premio::float AS custo, vendidos, total_numeros
         FROM rifas WHERE status = 'SORTEADA' AND sorteada_em >= now() - interval '180 days' ORDER BY sorteada_em DESC`
    ),
    db.query(
      `SELECT id, titulo, vendidos, total_numeros, encerra_em
         FROM rifas WHERE status = 'ABERTA' AND encerra_em IS NOT NULL AND encerra_em < now() + interval '3 days'
          AND vendidos::float / total_numeros < 0.5 ORDER BY encerra_em`
    ),
  ]);
  return { sorteadas: sorteadas.rows, emRisco: emRisco.rows };
}

module.exports = { panorama };
