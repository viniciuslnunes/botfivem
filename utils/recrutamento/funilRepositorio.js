const db = require('../db');

// Primeira entrada de cada ID como novato no período, com o que aconteceu no Discord depois
async function novatosDoPeriodo(inicio, fim) {
  const { rows } = await db.query(
    `WITH novatos AS (
       SELECT DISTINCT ON (ator_id_fivem) ator_id_fivem AS id_fivem, ator_nome, ocorrido_em
         FROM logs_jogo
        WHERE acao = 'novato_entrou' AND ator_id_fivem IS NOT NULL
          AND ($1::timestamptz IS NULL OR ocorrido_em >= $1) AND ocorrido_em < $2
        ORDER BY ator_id_fivem, ocorrido_em
     )
     SELECT n.id_fivem, n.ator_nome, n.ocorrido_em,
            EXISTS (SELECT 1 FROM fichas_recrutamento f WHERE f.id_fivem = n.id_fivem) AS pediu,
            EXISTS (SELECT 1 FROM fichas_recrutamento f WHERE f.id_fivem = n.id_fivem AND f.status = 'APROVADO') AS aprovado
       FROM novatos n
      ORDER BY n.ocorrido_em DESC`,
    [inicio, fim]
  );
  return rows;
}

// Registro genérico de alerta já enviado (um por tipo + chave)
async function alertasJaEnviados(tipo, chaves) {
  if (!chaves.length) return new Set();
  const { rows } = await db.query('SELECT chave FROM alertas_enviados WHERE tipo = $1 AND chave = ANY($2)', [tipo, chaves]);
  return new Set(rows.map(r => r.chave));
}

async function registrarAlertas(tipo, chaves) {
  if (!chaves.length) return;
  await db.query(
    `INSERT INTO alertas_enviados (tipo, chave) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`,
    [tipo, chaves]
  );
}

module.exports = { novatosDoPeriodo, alertasJaEnviados, registrarAlertas };
