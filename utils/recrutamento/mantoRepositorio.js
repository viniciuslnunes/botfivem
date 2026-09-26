const db = require('../db');

// Erro recuperado: o mesmo candidato mandou depois uma foto avaliada CORRETO
const RECUPERADO = `SELECT EXISTS (SELECT 1 FROM mantos_avaliados c
     WHERE c.candidato_id = m.candidato_id AND c.enviado_em > m.enviado_em AND c.resultado = 'CORRETO') AS ok`;

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
// `motivo` só existe em ERRADO; CORRETO limpa motivo e caso (o card antigo é
// fechado por quem chama, usando o `anterior` devolvido).
async function avaliarFoto(messageId, { resultado, porId, motivo = null }) {
  const { rows: antes } = await db.query('SELECT * FROM mantos_avaliados WHERE message_id = $1', [messageId]);
  if (!antes[0]) return null;
  const { rows } = await db.query(
    `UPDATE mantos_avaliados
        SET resultado = $2, avaliado_por_id = $3, avaliado_em = now(), motivo = $4,
            caso_canal_id = NULL, caso_message_id = NULL, caso_resolvido_por_id = NULL, caso_resolvido_em = NULL
      WHERE message_id = $1
      RETURNING *`,
    [messageId, resultado, porId, resultado === 'ERRADO' ? motivo : null]
  );
  return { ...rows[0], anterior: antes[0] };
}

// Foto + ficha vigente quando ela foi enviada: quem decidiu, quem o candidato citou
async function contextoDaFoto(messageId) {
  const { rows } = await db.query(
    `SELECT m.*, f.decidido_por_id, f.recrutador AS recrutador_citado, f.nome, f.id_fivem, f.status AS ficha_status
       FROM mantos_avaliados m
       LEFT JOIN LATERAL (
         SELECT decidido_por_id, recrutador, nome, id_fivem, status FROM fichas_recrutamento
          WHERE discord_id = m.candidato_id AND criado_em <= m.enviado_em
          ORDER BY criado_em DESC LIMIT 1
       ) f ON true
      WHERE m.message_id = $1`,
    [messageId]
  );
  return rows[0] ?? null;
}

async function gravarCaso(messageId, { canalId, mensagemId }) {
  await db.query(
    'UPDATE mantos_avaliados SET caso_canal_id = $2, caso_message_id = $3 WHERE message_id = $1',
    [messageId, canalId, mensagemId]
  );
}

// Só resolve caso ainda aberto: dois cliques simultâneos não resolvem duas vezes.
// null = já resolvido, revisto (manto virou CORRETO) ou inexistente.
async function resolverCaso(messageId, porId) {
  const { rows } = await db.query(
    `UPDATE mantos_avaliados
        SET caso_resolvido_por_id = $2, caso_resolvido_em = now()
      WHERE message_id = $1 AND resultado = 'ERRADO' AND caso_message_id IS NOT NULL AND caso_resolvido_em IS NULL
      RETURNING *`,
    [messageId, porId]
  );
  return rows[0] ?? null;
}

// Acertos e erros por recrutador: o que aprovou a ficha vigente quando a foto foi
// enviada (a mais recente criada até aquele momento). Ficha REPROVADA fica de fora:
// quem reprovou pegou o problema, não errou. recrutador_id nulo = ficha ainda sem
// decisão; passa a contar sozinho quando for aprovada.
async function placarPorRecrutador() {
  const { rows } = await db.query(
    `SELECT f.decidido_por_id AS recrutador_id,
            count(*) FILTER (WHERE m.resultado = 'CORRETO')::int AS acertos,
            count(*) FILTER (WHERE m.resultado = 'ERRADO' AND NOT r.ok)::int AS erros,
            count(*) FILTER (WHERE m.resultado = 'ERRADO' AND r.ok)::int AS recuperados
       FROM mantos_avaliados m
       LEFT JOIN LATERAL (
         SELECT decidido_por_id, status FROM fichas_recrutamento
          WHERE discord_id = m.candidato_id AND criado_em <= m.enviado_em
          ORDER BY criado_em DESC LIMIT 1
       ) f ON true
       CROSS JOIN LATERAL (${RECUPERADO}) r
      WHERE m.resultado IS NOT NULL AND f.status IS DISTINCT FROM 'REPROVADO'
      GROUP BY f.decidido_por_id`
  );
  return rows;
}

// Motivos dos erros efetivos por recrutador (quem errou por quê)
async function motivosPorRecrutador() {
  const { rows } = await db.query(
    `SELECT f.decidido_por_id AS recrutador_id, m.motivo, count(*)::int AS total
       FROM mantos_avaliados m
       JOIN LATERAL (
         SELECT decidido_por_id, status FROM fichas_recrutamento
          WHERE discord_id = m.candidato_id AND criado_em <= m.enviado_em
          ORDER BY criado_em DESC LIMIT 1
       ) f ON true
       CROSS JOIN LATERAL (${RECUPERADO}) r
      WHERE m.resultado = 'ERRADO' AND NOT r.ok AND m.motivo IS NOT NULL
        AND f.decidido_por_id IS NOT NULL AND f.status = 'APROVADO'
      GROUP BY f.decidido_por_id, m.motivo`
  );
  return rows;
}

// Erros efetivos por quem APROVOU a ficha (base da advertência "manto aprovado
// errado"). A janela conta pelo que veio por último: a avaliação ou a aprovação
// (aprovar hoje um manto reprovado semana passada é erro de hoje).
async function errosEfetivosPorRecrutador(desde) {
  const { rows } = await db.query(
    `SELECT f.decidido_por_id AS discord_id, count(*)::int AS total
       FROM mantos_avaliados m
       JOIN LATERAL (
         SELECT decidido_por_id, status, decidido_em FROM fichas_recrutamento
          WHERE discord_id = m.candidato_id AND criado_em <= m.enviado_em
          ORDER BY criado_em DESC LIMIT 1
       ) f ON true
       CROSS JOIN LATERAL (${RECUPERADO}) r
      WHERE m.resultado = 'ERRADO' AND NOT r.ok AND f.status = 'APROVADO' AND f.decidido_por_id IS NOT NULL
        AND GREATEST(m.avaliado_em, f.decidido_em) >= $1
      GROUP BY f.decidido_por_id`,
    [desde]
  );
  return new Map(rows.map(r => [r.discord_id, r.total]));
}

// Fotos do candidato (mais antiga primeiro); `desde` limita à ficha vigente
async function fotosDoCandidato(candidatoId, desde = null) {
  const { rows } = await db.query(
    `SELECT message_id, resultado, motivo, enviado_em FROM mantos_avaliados
      WHERE candidato_id = $1 AND ($2::timestamptz IS NULL OR enviado_em >= $2)
      ORDER BY enviado_em`,
    [candidatoId, desde]
  );
  return rows;
}

// Quem avaliou, quanto e em quanto tempo (do envio da foto à avaliação)
async function desempenhoAvaliadores(dias) {
  const { rows } = await db.query(
    `SELECT avaliado_por_id, count(*)::int AS total,
            avg(extract(epoch FROM (avaliado_em - enviado_em)))::float AS media_s
       FROM mantos_avaliados
      WHERE resultado IS NOT NULL AND avaliado_por_id IS NOT NULL AND avaliado_em >= now() - ($1 || ' days')::interval
      GROUP BY avaliado_por_id ORDER BY total DESC`,
    [String(dias)]
  );
  return rows;
}

// Números do período para o boletim e /inteligencia
async function resumoDoPeriodo(dias) {
  const janela = String(dias);
  const { rows: [geral] } = await db.query(
    `SELECT count(*) FILTER (WHERE resultado = 'CORRETO')::int AS corretos,
            count(*) FILTER (WHERE resultado = 'ERRADO')::int AS errados,
            count(*) FILTER (WHERE resultado IS NULL)::int AS pendentes,
            count(*) FILTER (WHERE resultado = 'ERRADO' AND caso_message_id IS NOT NULL AND caso_resolvido_em IS NULL)::int AS casos_abertos,
            avg(extract(epoch FROM (avaliado_em - enviado_em))) FILTER (WHERE resultado IS NOT NULL)::float AS media_s
       FROM mantos_avaliados WHERE enviado_em >= now() - ($1 || ' days')::interval`,
    [janela]
  );
  const { rows: motivos } = await db.query(
    `SELECT motivo, count(*)::int AS total FROM mantos_avaliados
      WHERE resultado = 'ERRADO' AND motivo IS NOT NULL AND enviado_em >= now() - ($1 || ' days')::interval
      GROUP BY motivo ORDER BY total DESC`,
    [janela]
  );
  return { ...geral, motivos };
}

async function contarPendentes() {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM mantos_avaliados WHERE resultado IS NULL');
  return rows[0].n;
}

module.exports = {
  registrarFoto, desfazerRegistro, avaliarFoto, contextoDaFoto, gravarCaso, resolverCaso, placarPorRecrutador, contarPendentes,
  motivosPorRecrutador, errosEfetivosPorRecrutador, fotosDoCandidato, desempenhoAvaliadores, resumoDoPeriodo,
};
