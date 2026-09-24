const db = require('../db');

async function inserir(a) {
  const res = await db.query(
    `INSERT INTO advertencias_recrutador (discord_id, nivel, regra, motivo, status, prazo_em)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [a.discordId, a.nivel, a.regra, a.motivo, a.status ?? 'ATIVA', a.prazoEm ?? null]
  );
  return res.rows[0];
}

async function contarAtivas(discordId) {
  const res = await db.query("SELECT count(*)::int AS n FROM advertencias_recrutador WHERE discord_id = $1 AND status = 'ATIVA'", [discordId]);
  return res.rows[0].n;
}

// Última advertência (qualquer status) de cada regra, por recrutador: base do intervalo mínimo
async function ultimasPorRegra() {
  const res = await db.query('SELECT discord_id, regra, max(criada_em) AS ultima FROM advertencias_recrutador GROUP BY discord_id, regra');
  const mapa = new Map();
  for (const r of res.rows) {
    if (!mapa.has(r.discord_id)) mapa.set(r.discord_id, {});
    mapa.get(r.discord_id)[r.regra] = r.ultima;
  }
  return mapa;
}

async function ativas() {
  const res = await db.query("SELECT * FROM advertencias_recrutador WHERE status = 'ATIVA' ORDER BY criada_em");
  return res.rows;
}

// Sai de ATIVA uma vez só: a segunda chamada devolve null
async function encerrar(id, status, resolucao) {
  const res = await db.query(
    `UPDATE advertencias_recrutador SET status = $2, resolucao = $3, resolvida_em = now()
      WHERE id = $1 AND status = 'ATIVA' RETURNING *`,
    [id, status, resolucao ?? null]
  );
  return res.rows[0] ?? null;
}

async function encerradasRecentes(limite = 10) {
  const res = await db.query(
    "SELECT * FROM advertencias_recrutador WHERE status <> 'ATIVA' ORDER BY coalesce(resolvida_em, criada_em) DESC LIMIT $1",
    [limite]
  );
  return res.rows;
}

async function historicoDoMembro(discordId) {
  const res = await db.query('SELECT * FROM advertencias_recrutador WHERE discord_id = $1 ORDER BY criada_em DESC', [discordId]);
  return res.rows;
}

// Mantos avaliados ERRADO desde `desde`, por quem decidiu a ficha do candidato
// (mesma resolução do placar: a ficha mais recente até o envio da foto).
async function errosDeMantoPorRecrutador(desde) {
  const res = await db.query(
    `SELECT f.decidido_por_id AS discord_id, count(*)::int AS total
       FROM mantos_avaliados m
       JOIN LATERAL (
         SELECT decidido_por_id FROM fichas_recrutamento
          WHERE discord_id = m.candidato_id AND criado_em <= m.enviado_em
          ORDER BY criado_em DESC LIMIT 1
       ) f ON true
      WHERE m.resultado = 'ERRADO' AND m.avaliado_em >= $1 AND f.decidido_por_id IS NOT NULL
      GROUP BY f.decidido_por_id`,
    [desde]
  );
  return new Map(res.rows.map(r => [r.discord_id, r.total]));
}

// Fichas APROVADAS com dado obrigatório faltando, por quem aprovou
async function fichasIncompletasPorRecrutador(desde) {
  const res = await db.query(
    `SELECT decidido_por_id AS discord_id, count(*)::int AS total
       FROM fichas_recrutamento
      WHERE status = 'APROVADO' AND decidido_em >= $1 AND decidido_por_id IS NOT NULL
        AND (btrim(coalesce(nome, '')) = '' OR idade IS NULL
             OR btrim(coalesce(id_fivem, '')) = '' OR btrim(coalesce(telefone, '')) = '')
      GROUP BY decidido_por_id`,
    [desde]
  );
  return new Map(res.rows.map(r => [r.discord_id, r.total]));
}

async function cargoDesde() {
  const res = await db.query('SELECT discord_id, desde FROM recrutadores_cargo');
  return new Map(res.rows.map(r => [r.discord_id, r.desde]));
}

module.exports = {
  inserir, contarAtivas, ultimasPorRegra, ativas, encerrar, encerradasRecentes, historicoDoMembro,
  errosDeMantoPorRecrutador, fichasIncompletasPorRecrutador, cargoDesde,
};
