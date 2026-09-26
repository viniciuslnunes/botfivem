// Consultas da inteligência cruzada. Só leitura (exceto associado_resumo). Cada função responde
// uma pergunta que nenhum painel fazia; as regras que interpretam o resultado ficam em regras.js.
const db = require('../db');
const A = require('../logsJogo/analises');

const ACOES_ADICIONOU = Object.values(A.TIPOS_RESTRICAO).map(t => t.adicionou);
const dias = n => String(n);

// ── Disciplina ───────────────────────────────────────────────────────────────

// Restrições adicionadas no jogo por alvo (ID do jogo) na janela
async function restricoesAdicionadas(diasJanela) {
  const { rows } = await db.query(
    `SELECT alvo_id_fivem AS id_fivem, acao, ocorrido_em AS em
       FROM logs_jogo
      WHERE acao = ANY($1) AND alvo_id_fivem IS NOT NULL
        AND ocorrido_em >= now() - ($2 || ' days')::interval`,
    [ACOES_ADICIONOU, dias(diasJanela)]
  );
  return rows;
}

// ADV de sócio na janela (qualquer status) e o estado atual por associado
async function advSocioNaJanela(diasJanela) {
  const { rows } = await db.query(
    `SELECT id, discord_id, id_fivem, nivel, status, prazo_em, resolvida_em, criada_em AS em
       FROM advertencias_socio WHERE criada_em >= now() - ($1 || ' days')::interval`,
    [dias(diasJanela)]
  );
  return rows;
}

async function advSocioAtivas() {
  const { rows } = await db.query(
    `SELECT discord_id, MAX(id_fivem) AS id_fivem, COUNT(*)::int AS ativas, MAX(nivel)::int AS nivel_max,
            BOOL_OR(nivel >= 2 AND prazo_em IS NOT NULL) AS pagamento_pendente
       FROM advertencias_socio WHERE status = 'ATIVA' GROUP BY discord_id`
  );
  return rows;
}

// Última restrição por (alvo, tipo): estado atual
async function restricoesAtivasPorAlvo() {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (alvo_id_fivem, split_part(acao, '_', 1)) alvo_id_fivem AS id_fivem, acao, ocorrido_em AS em
       FROM logs_jogo
      WHERE alvo_id_fivem IS NOT NULL
        AND acao IN (SELECT unnest($1::text[]))
      ORDER BY alvo_id_fivem, split_part(acao, '_', 1), ocorrido_em DESC, id DESC`,
    [A.ACOES_RESTRICAO]
  );
  return rows.filter(r => ACOES_ADICIONOU.includes(r.acao));
}

// ── Recrutamento ─────────────────────────────────────────────────────────────

async function fichasDoPeriodo(diasJanela) {
  const { rows } = await db.query(
    `SELECT message_id, discord_id, nome, id_fivem, status, decidido_por_id, decidido_em, criado_em, reprovado_categoria
       FROM fichas_recrutamento WHERE criado_em >= now() - ($1 || ' days')::interval`,
    [dias(diasJanela)]
  );
  return rows;
}

async function motivosDeReprovacao(diasJanela) {
  const { rows } = await db.query(
    `SELECT COALESCE(reprovado_categoria, 'sem categoria') AS categoria, COUNT(*)::int AS total
       FROM fichas_recrutamento
      WHERE status = 'REPROVADO' AND decidido_em >= now() - ($1 || ' days')::interval
      GROUP BY 1 ORDER BY total DESC`,
    [dias(diasJanela)]
  );
  return rows;
}

// Quem aprovou e quantos dos aprovados tiveram ADV de sócio ou restrição no jogo nos 30 dias
// seguintes à aprovação. Os mais novos ainda podem entrar nessa conta depois.
async function aprovadoresComProblema(diasJanela) {
  const { rows } = await db.query(
    `SELECT f.decidido_por_id AS aprovador_id,
            COUNT(*)::int AS aprovados,
            COUNT(*) FILTER (WHERE
              EXISTS (SELECT 1 FROM advertencias_socio a
                       WHERE a.discord_id = f.discord_id AND a.criada_em > f.decidido_em
                         AND a.criada_em <= f.decidido_em + interval '30 days')
              OR EXISTS (SELECT 1 FROM logs_jogo l
                          WHERE l.alvo_id_fivem = f.id_fivem AND l.acao = ANY($2)
                            AND l.ocorrido_em > f.decidido_em AND l.ocorrido_em <= f.decidido_em + interval '30 days')
            )::int AS com_problema
       FROM fichas_recrutamento f
      WHERE f.status = 'APROVADO' AND f.decidido_por_id IS NOT NULL
        AND f.decidido_em >= now() - ($1 || ' days')::interval
      GROUP BY f.decidido_por_id`,
    [dias(diasJanela), ACOES_ADICIONOU]
  );
  return rows;
}

// Recrutamentos do jogo (ator recrutou alvo) na janela
async function recrutamentosDoJogo(diasJanela) {
  const { rows } = await db.query(
    `SELECT ator_id_fivem AS recrutador_id, alvo_id_fivem AS id, alvo_nome AS nome, ocorrido_em AS em
       FROM logs_jogo
      WHERE acao = 'jogador_recrutou' AND alvo_id_fivem IS NOT NULL
        AND ocorrido_em >= now() - ($1 || ' days')::interval`,
    [dias(diasJanela)]
  );
  return rows;
}

// IDs do jogo com ficha aprovada (a qualquer tempo): quem foi validado pelo Discord
async function idsComFichaAprovada(ids) {
  if (!ids.length) return new Set();
  const { rows } = await db.query(
    `SELECT DISTINCT id_fivem FROM fichas_recrutamento WHERE status = 'APROVADO' AND id_fivem = ANY($1)`,
    [ids]
  );
  return new Set(rows.map(r => r.id_fivem));
}

// Funil por candidato, a partir da FICHA (Discord) e do jogo: ficha → aprovada → manto correto →
// recrutada no jogo → ainda jogando 7+ dias depois. (O funil antigo partia de novato_entrou, que só
// vinha de um canal removido; a ficha é o começo confiável.) Vale a última ficha de cada candidato.
async function funilDeFichas(diasJanela) {
  const { rows } = await db.query(
    `WITH ult AS (
       SELECT DISTINCT ON (discord_id) discord_id, id_fivem, status, criado_em
         FROM fichas_recrutamento
        WHERE criado_em >= now() - ($1 || ' days')::interval
        ORDER BY discord_id, criado_em DESC
     ), etapas AS (
       SELECT u.*, (u.status = 'APROVADO') AS aprovada,
              EXISTS (SELECT 1 FROM mantos_avaliados m WHERE m.candidato_id = u.discord_id
                         AND m.resultado = 'CORRETO' AND m.enviado_em >= u.criado_em) AS manto,
              (SELECT MIN(l.ocorrido_em) FROM logs_jogo l
                WHERE l.acao = 'jogador_recrutou' AND l.alvo_id_fivem = u.id_fivem AND l.ocorrido_em >= u.criado_em) AS recrutado_em
         FROM ult u
     )
     SELECT COUNT(*)::int AS fichas,
            COUNT(*) FILTER (WHERE aprovada)::int AS aprovadas,
            COUNT(*) FILTER (WHERE aprovada AND manto)::int AS manto_correto,
            COUNT(*) FILTER (WHERE aprovada AND recrutado_em IS NOT NULL)::int AS recrutadas,
            COUNT(*) FILTER (WHERE aprovada AND recrutado_em <= now() - interval '7 days')::int AS maduras7,
            COUNT(*) FILTER (WHERE aprovada AND recrutado_em <= now() - interval '7 days'
                               AND EXISTS (SELECT 1 FROM logs_jogo x WHERE x.acao = 'jogador_entrou'
                                             AND x.ator_id_fivem = etapas.id_fivem AND x.ocorrido_em >= etapas.recrutado_em + interval '7 days'))::int AS jogaram7d
       FROM etapas`,
    [dias(diasJanela)]
  );
  return rows[0];
}

// ── Liderança ────────────────────────────────────────────────────────────────

async function restricoesPorEvento(diasJanela) {
  const { rows } = await db.query(
    `SELECT acao, ator_id_fivem, alvo_id_fivem, ocorrido_em
       FROM logs_jogo WHERE acao = ANY($1) AND ocorrido_em >= now() - ($2 || ' days')::interval`,
    [A.ACOES_RESTRICAO, dias(diasJanela)]
  );
  return rows;
}

async function movimentosDeCargo(diasJanela) {
  const { rows } = await db.query(
    `SELECT acao, ator_id_fivem, ator_nome, alvo_id_fivem, ocorrido_em
       FROM logs_jogo WHERE acao IN ('promoveu_cargo', 'rebaixou_cargo') AND ocorrido_em >= now() - ($1 || ' days')::interval`,
    [dias(diasJanela)]
  );
  return rows;
}

// ── Baú, banco e território ──────────────────────────────────────────────────

// Movimento de baú por ID (todos os itens, mesma unidade "peças"): guardou × retirou
async function movimentoBauPorId(diasJanela) {
  const { rows } = await db.query(
    `SELECT ator_id_fivem AS id,
            COALESCE(SUM(valor) FILTER (WHERE acao = 'bau_guardou'), 0)::float AS entrou,
            COALESCE(SUM(valor) FILTER (WHERE acao = 'bau_removeu'), 0)::float AS saiu
       FROM logs_jogo
      WHERE acao IN ('bau_guardou', 'bau_removeu') AND ator_id_fivem IS NOT NULL AND valor IS NOT NULL
        AND ocorrido_em >= now() - ($1 || ' days')::interval
      GROUP BY 1`,
    [dias(diasJanela)]
  );
  return rows;
}

// Depósitos × saques do banco da torcida por ID (dinheiro do jogo)
async function movimentoBancoPorId(diasJanela) {
  const { rows } = await db.query(
    `SELECT ator_id_fivem AS id,
            COALESCE(SUM(valor) FILTER (WHERE acao = 'banco_depositou'), 0)::float AS entrou,
            COALESCE(SUM(valor) FILTER (WHERE acao = 'banco_sacou'), 0)::float AS saiu
       FROM logs_jogo
      WHERE acao IN ('banco_depositou', 'banco_sacou') AND ator_id_fivem IS NOT NULL AND valor IS NOT NULL
        AND ocorrido_em >= now() - ($1 || ' days')::interval
      GROUP BY 1`,
    [dias(diasJanela)]
  );
  return rows;
}

async function conquistasPorHora(diasJanela) {
  const { rows } = await db.query(
    `SELECT date_part('hour', ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::int AS hora, COUNT(*)::int AS total
       FROM logs_jogo
      WHERE acao IN ('coins_dominacao', 'coins_conquista') AND ocorrido_em >= now() - ($1 || ' days')::interval
      GROUP BY 1 ORDER BY 1`,
    [dias(diasJanela)]
  );
  return rows;
}

// Entradas no jogo por hora do dia, dividido pelos dias da janela: média de gente chegando
async function entradasPorHora(diasJanela) {
  const { rows } = await db.query(
    `SELECT date_part('hour', ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::int AS hora,
            (COUNT(*)::float / $2::float) AS media
       FROM logs_jogo
      WHERE acao = 'jogador_entrou' AND ocorrido_em >= now() - ($1 || ' days')::interval
      GROUP BY 1 ORDER BY 1`,
    [dias(diasJanela), diasJanela]
  );
  return rows;
}

// ── Eventos ──────────────────────────────────────────────────────────────────

// Quem confirmou e não apareceu, por pessoa (mínimo de confirmações para não punir amostra pequena)
async function noShowPorPessoa(diasJanela, minimoConfirmacoes = 3) {
  const { rows } = await db.query(
    `SELECT i.discord_id,
            COUNT(*) FILTER (WHERE i.status = 'CONFIRMADO')::int AS confirmou,
            COUNT(*) FILTER (WHERE i.status = 'CONFIRMADO' AND i.presente_em IS NULL)::int AS faltou
       FROM evento_inscricoes i JOIN eventos e ON e.id = i.evento_id
      WHERE e.status <> 'CANCELADO' AND e.inicio_em <= now()
        AND e.inicio_em >= now() - ($1 || ' days')::interval
      GROUP BY i.discord_id
     HAVING COUNT(*) FILTER (WHERE i.status = 'CONFIRMADO') >= $2
      ORDER BY faltou DESC, confirmou DESC`,
    [dias(diasJanela), minimoConfirmacoes]
  );
  return rows;
}

async function eventosPorHora(diasJanela) {
  const { rows } = await db.query(
    `SELECT date_part('hour', e.inicio_em AT TIME ZONE 'America/Sao_Paulo')::int AS hora,
            COUNT(DISTINCT e.id)::int AS eventos,
            COUNT(*) FILTER (WHERE i.presente_em IS NOT NULL)::int AS presentes,
            COUNT(*) FILTER (WHERE i.status = 'CONFIRMADO')::int AS confirmados
       FROM eventos e LEFT JOIN evento_inscricoes i ON i.evento_id = e.id
      WHERE e.status <> 'CANCELADO' AND e.inicio_em <= now() AND e.inicio_em >= now() - ($1 || ' days')::interval
      GROUP BY 1 ORDER BY 1`,
    [dias(diasJanela)]
  );
  return rows;
}

// ── Saídas, coortes e cobertura ──────────────────────────────────────────────

const ACOES_SAIDA = ['saiu_torcida', 'expulso_torcida', 'removido_torcida_automatico'];

// Saídas da torcida com o contexto: quando a pessoa foi recrutada (tempo de casa) e se teve ADV ou
// restrição nos 30 dias antes de sair. Em saiu_torcida quem saiu é o ATOR; nas outras, o alvo.
async function saidasComContexto(diasJanela) {
  const { rows } = await db.query(
    `SELECT s.acao, s.id, s.em,
            (SELECT MIN(r.ocorrido_em) FROM logs_jogo r
              WHERE r.acao = 'jogador_recrutou' AND r.alvo_id_fivem = s.id AND r.ocorrido_em < s.em) AS recrutado_em,
            EXISTS (SELECT 1 FROM logs_jogo x WHERE x.alvo_id_fivem = s.id AND x.acao = ANY($2)
                      AND x.ocorrido_em BETWEEN s.em - interval '30 days' AND s.em) AS teve_restricao,
            EXISTS (SELECT 1 FROM advertencias_socio a WHERE a.id_fivem = s.id
                      AND a.criada_em BETWEEN s.em - interval '30 days' AND s.em) AS teve_adv
       FROM (SELECT acao, CASE WHEN acao = 'saiu_torcida' THEN ator_id_fivem ELSE alvo_id_fivem END AS id, ocorrido_em AS em
               FROM logs_jogo WHERE acao = ANY($3) AND ocorrido_em >= now() - ($1 || ' days')::interval) s
      WHERE s.id IS NOT NULL
      ORDER BY s.em DESC`,
    [dias(diasJanela), ACOES_ADICIONOU, ACOES_SAIDA]
  );
  return rows;
}

// Coorte = mês do recrutamento. Dos "maduros" (recrutados há 7 ou 30+ dias), quantos NÃO saíram nesse prazo.
async function coortesDeRecrutamento(diasJanela) {
  const ficou = dia => `COUNT(*) FILTER (WHERE rc.em <= now() - interval '${dia} days' AND NOT EXISTS (
       SELECT 1 FROM logs_jogo s WHERE s.acao = ANY($2)
          AND ((s.acao = 'saiu_torcida' AND s.ator_id_fivem = rc.id) OR (s.acao <> 'saiu_torcida' AND s.alvo_id_fivem = rc.id))
          AND s.ocorrido_em > rc.em AND s.ocorrido_em <= rc.em + interval '${dia} days'))::int`;
  const { rows } = await db.query(
    `SELECT to_char(date_trunc('month', rc.em AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM') AS mes,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE rc.em <= now() - interval '7 days')::int AS maduros7, ${ficou(7)} AS ficaram7,
            COUNT(*) FILTER (WHERE rc.em <= now() - interval '30 days')::int AS maduros30, ${ficou(30)} AS ficaram30
       FROM (SELECT alvo_id_fivem AS id, MIN(ocorrido_em) AS em FROM logs_jogo
              WHERE acao = 'jogador_recrutou' AND alvo_id_fivem IS NOT NULL
                AND ocorrido_em >= now() - ($1 || ' days')::interval
              GROUP BY alvo_id_fivem) rc
      GROUP BY 1 ORDER BY 1`,
    [dias(diasJanela), ACOES_SAIDA]
  );
  return rows;
}

async function fichasPorHora(diasJanela) {
  const { rows } = await db.query(
    `SELECT date_part('hour', criado_em AT TIME ZONE 'America/Sao_Paulo')::int AS hora, (COUNT(*)::float / $2::float) AS media
       FROM fichas_recrutamento WHERE criado_em >= now() - ($1 || ' days')::interval GROUP BY 1 ORDER BY 1`,
    [dias(diasJanela), diasJanela]
  );
  return rows;
}

async function entradasDeIdsPorHora(ids, diasJanela) {
  if (!ids.length) return [];
  const { rows } = await db.query(
    `SELECT date_part('hour', ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::int AS hora, (COUNT(*)::float / $3::float) AS media
       FROM logs_jogo
      WHERE acao = 'jogador_entrou' AND ator_id_fivem = ANY($1) AND ocorrido_em >= now() - ($2 || ' days')::interval
      GROUP BY 1 ORDER BY 1`,
    [ids, dias(diasJanela), diasJanela]
  );
  return rows;
}

// ── Efetividade da advertência ───────────────────────────────────────────────

// Cada ADV com o que veio depois: o associado saiu em 30 dias? teve outra ADV ou restrição em 60?
async function advSocioEfetividade(diasJanela) {
  const { rows } = await db.query(
    `SELECT a.id, a.status, a.registrado_por, a.criada_em, a.resolvida_em, a.prazo_em,
            EXISTS (SELECT 1 FROM logs_jogo s WHERE s.acao = ANY($2)
                      AND ((s.acao = 'saiu_torcida' AND s.ator_id_fivem = a.id_fivem) OR (s.acao <> 'saiu_torcida' AND s.alvo_id_fivem = a.id_fivem))
                      AND s.ocorrido_em > a.criada_em AND s.ocorrido_em <= a.criada_em + interval '30 days') AS saiu30,
            (EXISTS (SELECT 1 FROM advertencias_socio b WHERE b.discord_id = a.discord_id AND b.id <> a.id
                       AND b.criada_em > a.criada_em AND b.criada_em <= a.criada_em + interval '60 days')
             OR EXISTS (SELECT 1 FROM logs_jogo r WHERE r.alvo_id_fivem = a.id_fivem AND r.acao = ANY($3)
                          AND r.ocorrido_em > a.criada_em AND r.ocorrido_em <= a.criada_em + interval '60 days')) AS reincidiu60
       FROM advertencias_socio a WHERE a.criada_em >= now() - ($1 || ' days')::interval`,
    [dias(diasJanela), ACOES_SAIDA, ACOES_ADICIONOU]
  );
  return rows;
}

// ── Baú: retirada fora do padrão da pessoa ───────────────────────────────────

async function retiradasBauRecentes(horas) {
  const { rows } = await db.query(
    `SELECT ator_id_fivem AS id, alvo_nome AS item, valor::float AS quantidade, titulo, ocorrido_em AS em
       FROM logs_jogo
      WHERE acao = 'bau_removeu' AND valor IS NOT NULL AND ator_id_fivem IS NOT NULL
        AND ocorrido_em >= now() - ($1 || ' hours')::interval
      ORDER BY ocorrido_em`,
    [String(horas)]
  );
  return rows;
}

// Mediana das retiradas anteriores (60 dias até `horas` atrás) por pessoa e item
async function historicoDeRetiradas(ids, horas) {
  if (!ids.length) return [];
  const { rows } = await db.query(
    `SELECT ator_id_fivem AS id, lower(alvo_nome) AS item, COUNT(*)::int AS n,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY valor)::float AS mediana
       FROM logs_jogo
      WHERE acao = 'bau_removeu' AND valor IS NOT NULL AND ator_id_fivem = ANY($1)
        AND ocorrido_em >= now() - interval '60 days' AND ocorrido_em < now() - ($2 || ' hours')::interval
      GROUP BY 1, 2`,
    [ids, String(horas)]
  );
  return rows;
}

// ── Patrimônio e eventos ─────────────────────────────────────────────────────

// Estado deduzido do evento mais recente de cada peça: se o último foi "removeu", está fora do baú
async function patrimonioForaDoBau() {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (lower(alvo_nome)) alvo_nome AS item, acao, ator_id_fivem, ocorrido_em AS em
       FROM logs_jogo
      WHERE acao IN ('patrimonio_guardou', 'patrimonio_removeu') AND alvo_nome IS NOT NULL
      ORDER BY lower(alvo_nome), ocorrido_em DESC, id DESC`
  );
  return rows.filter(r => r.acao === 'patrimonio_removeu').sort((a, b) => new Date(a.em) - new Date(b.em));
}

async function eventosComPresenca(diasJanela, limite) {
  const { rows } = await db.query(
    `SELECT e.id, e.titulo, e.inicio_em,
            COALESCE(ARRAY_AGG(i.discord_id) FILTER (WHERE i.presente_em IS NOT NULL), '{}') AS presentes,
            COALESCE(ARRAY_AGG(i.discord_id) FILTER (WHERE i.status = 'CONFIRMADO'), '{}') AS confirmados
       FROM eventos e LEFT JOIN evento_inscricoes i ON i.evento_id = e.id
      WHERE e.status <> 'CANCELADO' AND e.inicio_em <= now() AND e.inicio_em >= now() - ($1 || ' days')::interval
      GROUP BY e.id ORDER BY e.inicio_em DESC LIMIT $2`,
    [dias(diasJanela), limite]
  );
  return rows;
}

// ── Acompanhamento entre fluxos ──────────────────────────────────────────────

// Última ficha do candidato (qualquer status)
async function ultimaFichaDoCandidato(discordId) {
  const { rows } = await db.query(
    `SELECT message_id, discord_id, nome, id_fivem, status, criado_em, decidido_em, decidido_por_id,
            reprovado_categoria, reprovado_motivo, permite_reenvio
       FROM fichas_recrutamento WHERE discord_id = $1 ORDER BY criado_em DESC LIMIT 1`,
    [discordId]
  );
  return rows[0] ?? null;
}

// Primeiro recrutamento do ID no jogo depois de `desde` (null = ainda não foi setado)
async function recrutadoNoJogoDesde(idFivem, desde) {
  if (!idFivem) return null;
  const { rows } = await db.query(
    `SELECT MIN(ocorrido_em) AS em FROM logs_jogo WHERE acao = 'jogador_recrutou' AND alvo_id_fivem = $1 AND ocorrido_em >= $2`,
    [idFivem, desde]
  );
  return rows[0]?.em ?? null;
}

async function entrouNoJogoDesde(idFivem, desde) {
  if (!idFivem) return false;
  const { rows } = await db.query(
    `SELECT 1 FROM logs_jogo WHERE acao = 'jogador_entrou' AND ator_id_fivem = $1 AND ocorrido_em >= $2 LIMIT 1`,
    [idFivem, desde]
  );
  return rows.length > 0;
}

// Saídas dos últimos dias de quem NÃO voltou (sem novo recrutamento depois): base do
// "saiu no jogo e continua sócio no Discord". Em saiu_torcida quem saiu é o ator.
async function saidasRecentesSemRetorno(diasJanela) {
  const { rows } = await db.query(
    `SELECT s.acao, s.id, s.em FROM (
        SELECT acao, CASE WHEN acao = 'saiu_torcida' THEN ator_id_fivem ELSE alvo_id_fivem END AS id, ocorrido_em AS em
          FROM logs_jogo WHERE acao = ANY($2) AND ocorrido_em >= now() - ($1 || ' days')::interval
      ) s
      WHERE s.id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM logs_jogo r WHERE r.acao = 'jogador_recrutou' AND r.alvo_id_fivem = s.id AND r.ocorrido_em > s.em)
      ORDER BY s.em DESC`,
    [dias(diasJanela), ACOES_SAIDA]
  );
  return rows;
}

// Dos message_id dados, quais fichas ainda estão PENDENTES
async function fichasPendentes(ids) {
  if (!ids.length) return new Set();
  const { rows } = await db.query("SELECT message_id FROM fichas_recrutamento WHERE status = 'PENDENTE' AND message_id = ANY($1)", [ids]);
  return new Set(rows.map(x => x.message_id));
}

// ── Resumo persistido ────────────────────────────────────────────────────────

async function gravarResumo(discordId, idFivem, risco, dados) {
  await db.query(
    `INSERT INTO associado_resumo (discord_id, id_fivem, risco, dados, atualizado_em)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (discord_id) DO UPDATE SET id_fivem = $2, risco = $3, dados = $4, atualizado_em = now()`,
    [discordId, idFivem, risco, JSON.stringify(dados)]
  );
}

async function resumoPorIdFivem(idFivem) {
  const { rows } = await db.query('SELECT * FROM associado_resumo WHERE id_fivem = $1 ORDER BY atualizado_em DESC LIMIT 1', [idFivem]);
  return rows[0] ?? null;
}

async function resumoDe(discordId) {
  const { rows } = await db.query('SELECT * FROM associado_resumo WHERE discord_id = $1', [discordId]);
  return rows[0] ?? null;
}

async function maioresRiscos(limite = 15, minimo = 30) {
  const { rows } = await db.query(
    'SELECT * FROM associado_resumo WHERE risco >= $2 ORDER BY risco DESC, atualizado_em DESC LIMIT $1',
    [limite, minimo]
  );
  return rows;
}

// Associados que "esfriaram" segundo o último resumo
async function esfriando(limite = 25) {
  const { rows } = await db.query(
    `SELECT * FROM associado_resumo WHERE (dados->>'esfriando')::boolean IS TRUE ORDER BY risco DESC LIMIT $1`,
    [limite]
  );
  return rows;
}

module.exports = {
  restricoesAdicionadas, advSocioNaJanela, advSocioAtivas, restricoesAtivasPorAlvo,
  fichasDoPeriodo, motivosDeReprovacao, aprovadoresComProblema, recrutamentosDoJogo, idsComFichaAprovada, funilDeFichas,
  restricoesPorEvento, movimentosDeCargo,
  movimentoBauPorId, movimentoBancoPorId, conquistasPorHora, entradasPorHora,
  noShowPorPessoa, eventosPorHora,
  saidasComContexto, coortesDeRecrutamento, fichasPorHora, entradasDeIdsPorHora, advSocioEfetividade,
  retiradasBauRecentes, historicoDeRetiradas, patrimonioForaDoBau, eventosComPresenca,
  fichasPendentes, ultimaFichaDoCandidato, recrutadoNoJogoDesde, entrouNoJogoDesde, saidasRecentesSemRetorno,
  gravarResumo, resumoDe, resumoPorIdFivem, maioresRiscos, esfriando,
};
