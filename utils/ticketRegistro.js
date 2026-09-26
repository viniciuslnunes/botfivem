const db = require('./db');

// Registro de tickets para medir tempo de atendimento. Tudo melhor esforço: o ticket
// funciona igual se o banco falhar.

async function abrir(canalId, categoria, abertoPorId) {
  await db.query(
    'INSERT INTO tickets_registro (canal_id, categoria, aberto_por_id) VALUES ($1, $2, $3) ON CONFLICT (canal_id) DO NOTHING',
    [canalId, categoria, abertoPorId]
  ).catch(err => console.error('[ticket] Erro ao registrar abertura:', err.message));
}

// Primeira mensagem de quem não é o dono do ticket nem bot = primeira resposta da equipe
async function fechar(canal, fechadoPorId, donoId) {
  let primeiraRespostaEm = null;
  try {
    const lote = await canal.messages.fetch({ limit: 100 });
    const equipe = [...lote.values()]
      .filter(m => !m.author.bot && m.author.id !== donoId)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)[0];
    if (equipe) primeiraRespostaEm = new Date(equipe.createdTimestamp);
  } catch { /* sem histórico: registra o fechamento sem a resposta */ }
  await db.query(
    `UPDATE tickets_registro SET fechado_em = now(), fechado_por_id = $2, primeira_resposta_em = COALESCE(primeira_resposta_em, $3)
      WHERE canal_id = $1`,
    [canal.id, fechadoPorId, primeiraRespostaEm]
  ).catch(err => console.error('[ticket] Erro ao registrar fechamento:', err.message));
}

async function resumo(dias) {
  const { rows } = await db.query(
    `SELECT categoria, COUNT(*)::int AS total,
            COUNT(fechado_em)::int AS fechados,
            COUNT(primeira_resposta_em)::int AS respondidos,
            AVG(EXTRACT(EPOCH FROM (primeira_resposta_em - aberto_em)))::float AS resposta_seg,
            AVG(EXTRACT(EPOCH FROM (fechado_em - aberto_em)))::float AS duracao_seg
       FROM tickets_registro
      WHERE aberto_em >= now() - ($1 || ' days')::interval
      GROUP BY categoria ORDER BY total DESC`,
    [String(dias)]
  );
  return rows;
}

module.exports = { abrir, fechar, resumo };
