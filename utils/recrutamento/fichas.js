const db = require('../db');
const { lerFichaDoEmbed } = require('./regras');

async function registrarFicha(f) {
  await db.query(
    `INSERT INTO fichas_recrutamento (message_id, discord_id, nome, idade, id_fivem, telefone, recrutador, area_slug)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (message_id) DO NOTHING`,
    [f.messageId, f.discordId, f.nome, parseInt(f.idade, 10) || null, f.idFivem, f.telefone, f.recrutador, f.areaSlug]
  );
}

// Última ficha do candidato decide se ele pode abrir outra
async function situacaoDoCandidato(discordId) {
  const { rows } = await db.query(
    `SELECT status, permite_reenvio, criado_em FROM fichas_recrutamento
      WHERE discord_id = $1 ORDER BY criado_em DESC LIMIT 1`,
    [discordId]
  );
  const ultima = rows[0];
  if (!ultima) return null;
  return {
    pendenteDesde: ultima.status === 'PENDENTE' ? ultima.criado_em : null,
    reprovacaoDefinitiva: ultima.status === 'REPROVADO' && ultima.permite_reenvio === false,
  };
}

async function buscarFicha(messageId) {
  const { rows } = await db.query('SELECT * FROM fichas_recrutamento WHERE message_id = $1', [messageId]);
  return rows[0] ?? null;
}

async function decidirFicha(messageId, decisao, embedReserva) {
  const params = [
    messageId, decisao.status, decisao.decididoPorId,
    decisao.categoria ?? null, decisao.motivo ?? null, decisao.permiteReenvio ?? null,
  ];
  const res = await db.query(
    `UPDATE fichas_recrutamento
        SET status = $2, decidido_por_id = $3, decidido_em = now(),
            reprovado_categoria = $4, reprovado_motivo = $5, permite_reenvio = $6
      WHERE message_id = $1`,
    params
  );
  if (res.rowCount > 0 || !embedReserva) return;

  // Ficha enviada antes do registro no banco: grava a partir do embed de análise
  const f = lerFichaDoEmbed(embedReserva.fields);
  if (!f.discordId) return;
  await db.query(
    `INSERT INTO fichas_recrutamento
       (message_id, discord_id, nome, idade, id_fivem, telefone, recrutador,
        status, decidido_por_id, decidido_em, reprovado_categoria, reprovado_motivo, permite_reenvio)
     VALUES ($1, $7, $8, $9, $10, $11, $12, $2, $3, now(), $4, $5, $6)
     ON CONFLICT (message_id) DO NOTHING`,
    [...params, f.discordId, f.nome, f.idade, f.idFivem, f.telefone, f.recrutador]
  );
}

// Quem está barrado hoje: a ÚLTIMA ficha de cada candidato é reprovação
// definitiva (mesma regra de situacaoDoCandidato). O bloqueio mora aqui, não em
// cargo — por isso sair e voltar do servidor não libera ninguém.
async function listarReprovacoesDefinitivas() {
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (discord_id)
              message_id, discord_id, nome, id_fivem, status, permite_reenvio,
              reprovado_categoria, reprovado_motivo, decidido_por_id, decidido_em, criado_em
         FROM fichas_recrutamento
        ORDER BY discord_id, criado_em DESC
     ) ultima
     WHERE status = 'REPROVADO' AND permite_reenvio = false
     ORDER BY COALESCE(decidido_em, criado_em) DESC`
  );
  return rows;
}

// Só libera o que ainda está como definitiva: dois cliques simultâneos não
// liberam (nem registram) duas vezes. null = já liberado ou ficha inexistente.
async function liberarReenvio(messageId, { porId, motivo }) {
  const { rows } = await db.query(
    `UPDATE fichas_recrutamento
        SET permite_reenvio = true, reenvio_liberado_por_id = $2,
            reenvio_liberado_em = now(), reenvio_liberado_motivo = $3
      WHERE message_id = $1 AND status = 'REPROVADO' AND permite_reenvio = false
      RETURNING message_id, discord_id, nome, id_fivem, reprovado_categoria`,
    [messageId, porId, motivo]
  );
  return rows[0] ?? null;
}

module.exports = {
  registrarFicha, situacaoDoCandidato, buscarFicha, decidirFicha, listarReprovacoesDefinitivas, liberarReenvio,
};
