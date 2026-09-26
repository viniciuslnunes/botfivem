const db = require('../db');

// Foto postada no provar-manto. Só registra na primeira vez (reedição não zera avaliação).
// Devolve true só para quem registrou de fato: quem recebe false não deve postar
// os botões de novo (evento duplicado, reedição ou outra instância).
async function registrarFoto({ messageId, candidatoId, enviadoEm }) {
  const { rows } = await db.query(
    `INSERT INTO mantos_avaliados (message_id, candidato_id, enviado_em)
     VALUES ($1, $2, $3) ON CONFLICT (message_id) DO NOTHING
     RETURNING message_id`,
    [messageId, candidatoId, enviadoEm ?? new Date()]
  );
  return rows.length > 0;
}

// Desfaz o registro quando os botões não puderam ser postados (senão a foto
// ficaria pendente sem botão e sem chance de nova tentativa).
async function desfazerRegistro(messageId) {
  await db.query('DELETE FROM mantos_avaliados WHERE message_id = $1 AND resultado IS NULL', [messageId]);
}

// Última avaliação vale: a liderança pode corrigir um clique errado.
// null = foto não registrada (enviada antes do recurso existir).
async function avaliarFoto(messageId, { resultado, porId }) {
  const { rows } = await db.query(
    `UPDATE mantos_avaliados
        SET resultado = $2, avaliado_por_id = $3, avaliado_em = now()
      WHERE message_id = $1
      RETURNING *`,
    [messageId, resultado, porId]
  );
  return rows[0] ?? null;
}

// Acertos e erros por recrutador: o que aprovou/decidiu a ficha vigente quando a
// foto foi enviada (a mais recente criada até aquele momento). recrutador_id
// nulo = ficha ainda sem decisão; passa a contar sozinho quando for decidida.
async function placarPorRecrutador() {
  const { rows } = await db.query(
    `SELECT f.decidido_por_id AS recrutador_id,
            count(*) FILTER (WHERE m.resultado = 'CORRETO')::int AS acertos,
            count(*) FILTER (WHERE m.resultado = 'ERRADO')::int AS erros
       FROM mantos_avaliados m
       LEFT JOIN LATERAL (
         SELECT decidido_por_id FROM fichas_recrutamento
          WHERE discord_id = m.candidato_id AND criado_em <= m.enviado_em
          ORDER BY criado_em DESC LIMIT 1
       ) f ON true
      WHERE m.resultado IS NOT NULL
      GROUP BY f.decidido_por_id`
  );
  return rows;
}

async function contarPendentes() {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM mantos_avaliados WHERE resultado IS NULL');
  return rows[0].n;
}

module.exports = { registrarFoto, desfazerRegistro, avaliarFoto, placarPorRecrutador, contarPendentes };
