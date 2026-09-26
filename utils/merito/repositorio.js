// Mérito de recrutadores: SQL. Só persistência e consultas de coleta; nenhuma
// regra de negócio (essa mora em regras.js).
const db = require('../db');

// ── Ciclos ───────────────────────────────────────────────────────────────────

const um = res => res.rows[0] ?? null;

async function cicloPorStatus(status) {
  return um(await db.query('SELECT * FROM merito_ciclos WHERE status = $1 ORDER BY numero DESC LIMIT 1', [status]));
}
const cicloAberto = () => cicloPorStatus('ABERTO');
const cicloEmVotacao = () => cicloPorStatus('EM_VOTACAO');

const ultimoConcluido = () => cicloPorStatus('CONCLUIDO');

async function ultimoCiclo() {
  return um(await db.query('SELECT * FROM merito_ciclos ORDER BY numero DESC LIMIT 1'));
}

async function buscarCiclo(id) {
  return um(await db.query('SELECT * FROM merito_ciclos WHERE id = $1', [id]));
}

async function cicloAnteriorA(numero) {
  return um(await db.query(
    "SELECT * FROM merito_ciclos WHERE numero < $1 AND status IN ('FECHADO', 'EM_VOTACAO', 'CONCLUIDO') ORDER BY numero DESC LIMIT 1", [numero]
  ));
}

// Idempotente: dois processos criando o mesmo número não duplicam
async function criarCiclo({ numero, inicio, fim, sombra, versaoRegras, config }) {
  const criado = um(await db.query(
    `INSERT INTO merito_ciclos (numero, inicio, fim, sombra, versao_regras, config)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (numero) DO NOTHING RETURNING *`,
    [numero, inicio, fim, sombra, versaoRegras, config]
  ));
  return criado ?? um(await db.query('SELECT * FROM merito_ciclos WHERE numero = $1', [numero]));
}

// Só sai de ABERTO uma vez: a segunda chamada devolve null (fechar duas vezes não duplica)
async function fecharCiclo(id, { status, votacaoAte = null }) {
  return um(await db.query(
    `UPDATE merito_ciclos SET status = $2, votacao_ate = $3, fechado_em = now()
      WHERE id = $1 AND status = 'ABERTO' RETURNING *`,
    [id, status, votacaoAte]
  ));
}

async function concluirCiclo(id) {
  return um(await db.query(
    "UPDATE merito_ciclos SET status = 'CONCLUIDO', concluido_em = now() WHERE id = $1 AND status = 'EM_VOTACAO' RETURNING *", [id]
  ));
}

// Prorroga uma vez só (WHERE prorrogada = false)
async function prorrogarVotacao(id, novoPrazo) {
  return um(await db.query(
    `UPDATE merito_ciclos SET votacao_ate = $2, prorrogada = true
      WHERE id = $1 AND status = 'EM_VOTACAO' AND prorrogada = false RETURNING *`,
    [id, novoPrazo]
  ));
}

// ── Semanas, resultado, selos ────────────────────────────────────────────────

async function gravarSemanas(cicloId, discordId, semanas) {
  for (const s of semanas) {
    await db.query(
      `INSERT INTO merito_semanas (ciclo_id, discord_id, semana, brutos, validos, pendentes, suspeitos, retidos, meta, dispensada, bateu, atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
       ON CONFLICT (ciclo_id, discord_id, semana) DO UPDATE
          SET brutos = $4, validos = $5, pendentes = $6, suspeitos = $7, retidos = $8, meta = $9, dispensada = $10, bateu = $11, atualizado_em = now()`,
      [cicloId, discordId, s.indice, s.brutos, s.validos, s.pendentes, s.suspeitos, s.retidos, s.meta, s.dispensada, s.bateu]
    );
  }
}

// Não mexe na decisão final (decisao*): ela pertence à liderança
async function gravarResultados(cicloId, linhas) {
  for (const l of linhas) {
    await db.query(
      `INSERT INTO merito_resultado (ciclo_id, discord_id, pontos, bonus, posicao, elegivel, motivos, indicado, detalhe, atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       ON CONFLICT (ciclo_id, discord_id) DO UPDATE
          SET pontos = $3, bonus = $4, posicao = $5, elegivel = $6, motivos = $7, indicado = $8, detalhe = $9, atualizado_em = now()`,
      [cicloId, l.discordId, l.pontos, l.bonus, l.posicao, l.elegivel, JSON.stringify(l.motivos), l.indicado ?? false, JSON.stringify(l.detalhe)]
    );
  }
}

async function resultadosDoCiclo(cicloId) {
  const { rows } = await db.query(
    'SELECT * FROM merito_resultado WHERE ciclo_id = $1 ORDER BY posicao NULLS LAST, (pontos + bonus) DESC', [cicloId]
  );
  return rows.map(r => ({ ...r, pontos: Number(r.pontos), bonus: Number(r.bonus) }));
}

async function resultadoDe(cicloId, discordId) {
  const r = um(await db.query('SELECT * FROM merito_resultado WHERE ciclo_id = $1 AND discord_id = $2', [cicloId, discordId]));
  return r ? { ...r, pontos: Number(r.pontos), bonus: Number(r.bonus) } : null;
}

async function semanasDe(cicloId, discordId) {
  const { rows } = await db.query('SELECT * FROM merito_semanas WHERE ciclo_id = $1 AND discord_id = $2 ORDER BY semana', [cicloId, discordId]);
  return rows;
}

// Decisão final da liderança sobre um indicado (promovido, adiado…). Guarda no SQL: só indicado.
async function registrarDecisao(cicloId, discordId, decisao, por) {
  return um(await db.query(
    `UPDATE merito_resultado SET decisao = $3, decisao_por = $4, decisao_em = now()
      WHERE ciclo_id = $1 AND discord_id = $2 AND indicado RETURNING *`,
    [cicloId, discordId, decisao, por]
  ));
}

async function gravarSelos(cicloId, selos) {
  for (const s of selos) {
    await db.query(
      'INSERT INTO merito_selos (ciclo_id, discord_id, selo) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [cicloId, s.discordId, s.selo]
    );
  }
}

async function selosDe(discordId) {
  const { rows } = await db.query(
    `SELECT s.selo, c.numero FROM merito_selos s JOIN merito_ciclos c ON c.id = s.ciclo_id
      WHERE s.discord_id = $1 ORDER BY c.numero DESC`, [discordId]
  );
  return rows;
}

// ── Votação ──────────────────────────────────────────────────────────────────

// Um voto por pessoa; trocar de indicado sobrescreve. indicadoId null = abstenção.
async function votar(cicloId, votanteId, indicadoId) {
  await db.query(
    `INSERT INTO merito_votos (ciclo_id, votante_id, indicado_id) VALUES ($1,$2,$3)
     ON CONFLICT (ciclo_id, votante_id) DO UPDATE SET indicado_id = $3, votado_em = now()`,
    [cicloId, votanteId, indicadoId]
  );
}

async function votosDoCiclo(cicloId) {
  const { rows } = await db.query('SELECT votante_id AS "votanteId", indicado_id AS "indicadoId" FROM merito_votos WHERE ciclo_id = $1', [cicloId]);
  return rows;
}

async function votoDe(cicloId, votanteId) {
  return um(await db.query('SELECT indicado_id AS "indicadoId" FROM merito_votos WHERE ciclo_id = $1 AND votante_id = $2', [cicloId, votanteId]));
}

async function vetar(cicloId, indicadoId, vetadoPor, motivo) {
  return um(await db.query(
    `INSERT INTO merito_vetos (ciclo_id, indicado_id, vetado_por, motivo) VALUES ($1,$2,$3,$4)
     ON CONFLICT (ciclo_id, indicado_id) DO NOTHING RETURNING *`,
    [cicloId, indicadoId, vetadoPor, motivo]
  ));
}

async function vetosDoCiclo(cicloId) {
  const { rows } = await db.query('SELECT indicado_id AS "indicadoId", vetado_por AS "vetadoPor", motivo FROM merito_vetos WHERE ciclo_id = $1', [cicloId]);
  return rows;
}

// ── Revisões (fraude e pedidos de semana dispensada) ─────────────────────────

async function registrarRevisao({ cicloId, discordId, tipo, chave, semana = null, detalhe = {}, status = 'PENDENTE' }) {
  return um(await db.query(
    `INSERT INTO merito_revisoes (ciclo_id, discord_id, tipo, chave, semana, detalhe, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (ciclo_id, discord_id, tipo, chave) DO NOTHING RETURNING *`,
    [cicloId, discordId, tipo, chave, semana, JSON.stringify(detalhe), status]
  ));
}

async function revisoesPendentes(cicloId) {
  const { rows } = await db.query(
    "SELECT * FROM merito_revisoes WHERE ciclo_id = $1 AND status = 'PENDENTE' ORDER BY criada_em", [cicloId]
  );
  return rows;
}

async function revisoesInformativas(cicloId) {
  const { rows } = await db.query(
    "SELECT * FROM merito_revisoes WHERE ciclo_id = $1 AND status = 'INFORMATIVA' ORDER BY criada_em DESC LIMIT 10", [cicloId]
  );
  return rows;
}

async function buscarRevisao(id) {
  if (!/^\d+$/.test(String(id))) return null;
  return um(await db.query('SELECT * FROM merito_revisoes WHERE id = $1', [id]));
}

// Decide uma vez só (WHERE status = 'PENDENTE'): clique duplo não decide de novo
async function decidirRevisao(id, status, por) {
  return um(await db.query(
    `UPDATE merito_revisoes SET status = $2, decidido_por = $3, decidido_em = now()
      WHERE id = $1 AND status = 'PENDENTE' RETURNING *`,
    [id, status, por]
  ));
}

// Map "discord|chave" → status, só dos tipos que retêm contagem (rajada, circulo)
async function decisoesDeFraude(cicloId) {
  const { rows } = await db.query(
    "SELECT discord_id, chave, status FROM merito_revisoes WHERE ciclo_id = $1 AND tipo IN ('rajada', 'circulo')", [cicloId]
  );
  return new Map(rows.map(r => [`${r.discord_id}|${r.chave}`, r.status]));
}

// Map discord → Set de semanas dispensadas aprovadas
async function dispensasAprovadas(cicloId) {
  const { rows } = await db.query(
    "SELECT discord_id, semana FROM merito_revisoes WHERE ciclo_id = $1 AND tipo = 'dispensa' AND status = 'APROVADA'", [cicloId]
  );
  const mapa = new Map();
  for (const r of rows) {
    if (!mapa.has(r.discord_id)) mapa.set(r.discord_id, new Set());
    mapa.get(r.discord_id).add(r.semana);
  }
  return mapa;
}

// Pedidos de dispensa que ocupam a cota (pendentes ou aprovados)
async function pedidosDeDispensa(cicloId, discordId) {
  const { rows } = await db.query(
    "SELECT * FROM merito_revisoes WHERE ciclo_id = $1 AND discord_id = $2 AND tipo = 'dispensa' AND status IN ('PENDENTE', 'APROVADA')",
    [cicloId, discordId]
  );
  return rows;
}

async function recrutadoresComRevisaoPendente(cicloId) {
  const { rows } = await db.query(
    "SELECT DISTINCT discord_id FROM merito_revisoes WHERE ciclo_id = $1 AND status = 'PENDENTE' AND tipo IN ('rajada', 'circulo')", [cicloId]
  );
  return new Set(rows.map(r => r.discord_id));
}

// ── Coleta (logs do jogo e fichas) ───────────────────────────────────────────

async function recrutamentosDoCiclo(idsFivem, inicio, fim) {
  if (!idsFivem.length) return [];
  const { rows } = await db.query(
    `SELECT ator_id_fivem AS recrutador, alvo_id_fivem AS recrutado, alvo_nome AS "recrutadoNome", ocorrido_em AS "ocorridoEm"
       FROM logs_jogo
      WHERE acao = 'jogador_recrutou' AND ator_id_fivem = ANY($1) AND alvo_id_fivem IS NOT NULL
        AND ocorrido_em >= $2 AND ocorrido_em < $3`,
    [idsFivem, inicio, fim]
  );
  return rows;
}

async function idsAprovadosComFicha(idsFivem) {
  if (!idsFivem.length) return new Set();
  const { rows } = await db.query(
    "SELECT DISTINCT id_fivem FROM fichas_recrutamento WHERE status = 'APROVADO' AND id_fivem = ANY($1)", [idsFivem]
  );
  return new Set(rows.map(r => r.id_fivem));
}

// Mantos avaliados (CORRETO/ERRADO) no ciclo, por quem decidiu a ficha do candidato
async function mantosDoCiclo(inicio, fim) {
  const { rows } = await db.query(
    `SELECT f.decidido_por_id AS discord_id,
            count(*)::int AS avaliados,
            count(*) FILTER (WHERE m.resultado = 'CORRETO')::int AS corretos
       FROM mantos_avaliados m
       JOIN LATERAL (
         SELECT decidido_por_id FROM fichas_recrutamento
          WHERE discord_id = m.candidato_id AND criado_em <= m.enviado_em
          ORDER BY criado_em DESC LIMIT 1
       ) f ON true
      WHERE m.resultado IS NOT NULL AND m.avaliado_em >= $1 AND m.avaliado_em < $2 AND f.decidido_por_id IS NOT NULL
      GROUP BY f.decidido_por_id`,
    [inicio, fim]
  );
  return new Map(rows.map(r => [r.discord_id, { avaliados: r.avaliados, corretos: r.corretos }]));
}

// Fichas APROVADAS no ciclo e quantas estavam completas, por quem aprovou
async function fichasDoCiclo(inicio, fim) {
  const { rows } = await db.query(
    `SELECT decidido_por_id AS discord_id,
            count(*)::int AS aprovadas,
            count(*) FILTER (WHERE btrim(coalesce(nome, '')) <> '' AND idade IS NOT NULL
                               AND btrim(coalesce(id_fivem, '')) <> '' AND btrim(coalesce(telefone, '')) <> '')::int AS completas
       FROM fichas_recrutamento
      WHERE status = 'APROVADO' AND decidido_em >= $1 AND decidido_em < $2 AND decidido_por_id IS NOT NULL
      GROUP BY decidido_por_id`,
    [inicio, fim]
  );
  return new Map(rows.map(r => [r.discord_id, { aprovadas: r.aprovadas, completas: r.completas }]));
}

module.exports = {
  cicloAberto, cicloEmVotacao, ultimoConcluido, ultimoCiclo, buscarCiclo, cicloAnteriorA, criarCiclo, fecharCiclo, concluirCiclo, prorrogarVotacao,
  gravarSemanas, gravarResultados, resultadosDoCiclo, resultadoDe, semanasDe, registrarDecisao, gravarSelos, selosDe,
  votar, votosDoCiclo, votoDe, vetar, vetosDoCiclo,
  registrarRevisao, revisoesPendentes, revisoesInformativas, buscarRevisao, decidirRevisao, decisoesDeFraude,
  dispensasAprovadas, pedidosDeDispensa, recrutadoresComRevisaoPendente,
  recrutamentosDoCiclo, idsAprovadosComFicha, mantosDoCiclo, fichasDoCiclo,
};
