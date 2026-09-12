const db = require('../db');
const { transacao } = require('../transacao');
const { decidirInscricao } = require('./regras');

async function criarEvento(e) {
  const { rows } = await db.query(
    `INSERT INTO eventos (tipo, titulo, descricao, local, inicio_em, capacidade, area_slug, serie_id, canal_id, criado_por_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [e.tipo, e.titulo, e.descricao, e.local, e.inicioEm, e.capacidade, e.areaSlug, e.serieId, e.canalId, e.criadoPorId]
  );
  return rows[0];
}

async function buscarEvento(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const { rows } = await db.query('SELECT * FROM eventos WHERE id = $1', [id]);
  return rows[0] ?? null;
}

async function gravarMensagem(eventoId, messageId) {
  await db.query('UPDATE eventos SET message_id = $2 WHERE id = $1', [eventoId, messageId]);
}

async function listarInscricoes(eventoId) {
  const { rows } = await db.query(
    'SELECT discord_id, status, criado_em, presente_em FROM evento_inscricoes WHERE evento_id = $1 ORDER BY criado_em',
    [eventoId]
  );
  return rows;
}

async function listarInscricoesComVeiculo(eventoId) {
  const { rows } = await db.query(
    'SELECT discord_id, status, criado_em, presente_em, veiculo_id FROM evento_inscricoes WHERE evento_id = $1 ORDER BY criado_em',
    [eventoId]
  );
  return rows;
}

async function listarProximos(limite = 25) {
  const { rows } = await db.query(
    `SELECT * FROM eventos WHERE status = 'ATIVO' AND inicio_em > now() - interval '12 hours'
      ORDER BY inicio_em LIMIT $1`,
    [limite]
  );
  return rows;
}

// Trava a linha do evento: duas confirmações simultâneas não estouram a capacidade
async function inscrever(eventoId, discordId) {
  return transacao(async c => {
    const { rows: [evento] } = await c.query('SELECT * FROM eventos WHERE id = $1 FOR UPDATE', [eventoId]);
    if (!evento) return { erro: 'nao_encontrado' };
    if (evento.status !== 'ATIVO' || new Date(evento.inicio_em) <= new Date()) return { erro: 'fechado', evento };

    const { rows: [atual] } = await c.query(
      'SELECT status FROM evento_inscricoes WHERE evento_id = $1 AND discord_id = $2', [eventoId, discordId]);
    if (atual && (atual.status === 'CONFIRMADO' || atual.status === 'ESPERA')) return { erro: 'ja_inscrito', status: atual.status, evento };

    const { rows: [{ total }] } = await c.query(
      "SELECT COUNT(*)::int AS total FROM evento_inscricoes WHERE evento_id = $1 AND status = 'CONFIRMADO'", [eventoId]);
    const status = decidirInscricao({ capacidade: evento.capacidade, confirmados: total });
    // Reentrar depois de desistir vai para o fim da fila (criado_em renovado)
    await c.query(
      `INSERT INTO evento_inscricoes (evento_id, discord_id, status) VALUES ($1, $2, $3)
       ON CONFLICT (evento_id, discord_id) DO UPDATE SET status = $3, criado_em = now(), atualizado_em = now()`,
      [eventoId, discordId, status]
    );
    return { status, evento };
  });
}

// Quem desiste libera a vaga para o primeiro da lista de espera
async function desistir(eventoId, discordId) {
  return transacao(async c => {
    const { rows: [evento] } = await c.query('SELECT * FROM eventos WHERE id = $1 FOR UPDATE', [eventoId]);
    if (!evento) return { erro: 'nao_encontrado' };
    if (evento.status !== 'ATIVO' || new Date(evento.inicio_em) <= new Date()) return { erro: 'fechado', evento };

    const { rows: [atual] } = await c.query(
      'SELECT status FROM evento_inscricoes WHERE evento_id = $1 AND discord_id = $2', [eventoId, discordId]);
    if (!atual || (atual.status !== 'CONFIRMADO' && atual.status !== 'ESPERA')) return { erro: 'nao_inscrito', evento };

    await c.query(
      "UPDATE evento_inscricoes SET status = 'DESISTIU', atualizado_em = now() WHERE evento_id = $1 AND discord_id = $2",
      [eventoId, discordId]
    );
    let promovido = null;
    if (atual.status === 'CONFIRMADO') {
      const { rows: [proximo] } = await c.query(
        `UPDATE evento_inscricoes SET status = 'CONFIRMADO', atualizado_em = now()
          WHERE (evento_id, discord_id) = (
            SELECT evento_id, discord_id FROM evento_inscricoes
             WHERE evento_id = $1 AND status = 'ESPERA' ORDER BY criado_em LIMIT 1 FOR UPDATE)
          RETURNING discord_id`,
        [eventoId]
      );
      promovido = proximo?.discord_id ?? null;
    }
    return { statusAnterior: atual.status, promovido, evento };
  });
}

// Presença é marcada por quem opera o evento; quem veio sem confirmar entra como AVULSO.
// Devolve só quem ainda não tinha presença (para não pontuar duas vezes).
async function marcarPresenca(eventoId, discordIds, porId) {
  return transacao(async c => {
    const { rows: jaPresentes } = await c.query(
      'SELECT discord_id FROM evento_inscricoes WHERE evento_id = $1 AND discord_id = ANY($2) AND presente_em IS NOT NULL',
      [eventoId, discordIds]
    );
    const ja = new Set(jaPresentes.map(r => r.discord_id));
    const novos = discordIds.filter(id => !ja.has(id));
    for (const id of novos) {
      await c.query(
        `INSERT INTO evento_inscricoes (evento_id, discord_id, status, presente_em, presenca_por_id)
         VALUES ($1, $2, 'AVULSO', now(), $3)
         ON CONFLICT (evento_id, discord_id) DO UPDATE SET presente_em = now(), presenca_por_id = $3, atualizado_em = now()`,
        [eventoId, id, porId]
      );
    }
    return novos;
  });
}

async function cancelarEventos(evento, escopo) {
  const { rows } = escopo === 'serie' && evento.serie_id
    ? await db.query(
      `UPDATE eventos SET status = 'CANCELADO'
        WHERE serie_id = $1 AND inicio_em >= $2 AND status = 'ATIVO' RETURNING *`,
      [evento.serie_id, evento.inicio_em])
    : await db.query("UPDATE eventos SET status = 'CANCELADO' WHERE id = $1 AND status = 'ATIVO' RETURNING *", [evento.id]);
  return rows;
}

async function eventosDoPeriodo(inicio, fim) {
  const { rows } = await db.query(
    `SELECT e.id, e.titulo, e.tipo, e.inicio_em,
            COUNT(*) FILTER (WHERE i.status = 'CONFIRMADO')::int AS confirmados,
            COUNT(*) FILTER (WHERE i.presente_em IS NOT NULL)::int AS presentes,
            COUNT(*) FILTER (WHERE i.status = 'CONFIRMADO' AND i.presente_em IS NULL)::int AS no_show
       FROM eventos e LEFT JOIN evento_inscricoes i ON i.evento_id = e.id
      WHERE e.status <> 'CANCELADO' AND e.inicio_em <= now()
        AND ($1::timestamptz IS NULL OR e.inicio_em >= $1) AND e.inicio_em < $2
      GROUP BY e.id ORDER BY e.inicio_em DESC`,
    [inicio, fim]
  );
  return rows;
}

async function maisPresentes(inicio, fim, limite = 10) {
  const { rows } = await db.query(
    `SELECT i.discord_id, COUNT(*)::int AS presencas
       FROM evento_inscricoes i JOIN eventos e ON e.id = i.evento_id
      WHERE i.presente_em IS NOT NULL AND e.status <> 'CANCELADO'
        AND ($1::timestamptz IS NULL OR e.inicio_em >= $1) AND e.inicio_em < $2
      GROUP BY i.discord_id ORDER BY presencas DESC LIMIT $3`,
    [inicio, fim, limite]
  );
  return rows;
}

module.exports = {
  criarEvento,
  buscarEvento,
  gravarMensagem,
  listarInscricoes,
  listarInscricoesComVeiculo,
  listarProximos,
  inscrever,
  desistir,
  marcarPresenca,
  cancelarEventos,
  eventosDoPeriodo,
  maisPresentes,
};
