const db = require('../db');

// Acesso ao banco dos logs do jogo. Colunas e ordenações são fixas aqui:
// nada vindo do usuário entra no SQL fora dos parâmetros.

function escaparLike(texto) {
  return String(texto).replace(/[\\%_]/g, c => `\\${c}`);
}

function montarFiltro(filtro = {}) {
  const condicoes = [];
  const params = [];
  const p = valor => {
    params.push(valor);
    return `$${params.length}`;
  };
  if (filtro.inicio) condicoes.push(`ocorrido_em >= ${p(filtro.inicio)}`);
  if (filtro.fim) condicoes.push(`ocorrido_em < ${p(filtro.fim)}`);
  if (filtro.idFivem) {
    const id = p(filtro.idFivem);
    condicoes.push(`(ator_id_fivem = ${id} OR alvo_id_fivem = ${id})`);
  }
  if (filtro.categoria) condicoes.push(`categoria = ${p(filtro.categoria)}`);
  if (filtro.acao) condicoes.push(`acao = ${p(filtro.acao)}`);
  if (filtro.texto) {
    const t = p(`%${escaparLike(filtro.texto)}%`);
    condicoes.push(`(descricao ILIKE ${t} OR titulo ILIKE ${t} OR ator_nome ILIKE ${t} OR alvo_nome ILIKE ${t})`);
  }
  return { condicoes, params };
}

function where(condicoes) {
  return condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
}

async function inserirRegistro(r) {
  const res = await db.query(
    `INSERT INTO logs_jogo
       (message_id, embed_indice, canal_id, categoria, acao, ator_nome, ator_id_fivem,
        alvo_nome, alvo_id_fivem, valor, titulo, descricao, ocorrido_em, bruto)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (message_id, embed_indice) DO NOTHING
     RETURNING id`,
    [r.messageId, r.embedIndice, r.canalId, r.categoria, r.acao, r.atorNome, r.atorIdFivem,
      r.alvoNome, r.alvoIdFivem, r.valor, r.titulo, r.descricao, r.ocorridoEm, r.bruto]
  );
  return res.rowCount > 0;
}

// Registros gravados como 'desconhecido', com o embed cru — pra reprocessar
// quando o parser aprende um formato novo (ver ingestao.reprocessarDesconhecidos).
async function desconhecidosComBruto(limite) {
  const res = await db.query(
    `SELECT id, bruto FROM logs_jogo WHERE acao = 'desconhecido'
      ORDER BY id LIMIT ${Number(limite)}`
  );
  return res.rows;
}

// Reescreve o que o parser passou a entender. Só o que ele extrai: message_id,
// canal e ocorrido_em não mudam nunca (e `bruto` é a fonte, fica intacta).
async function atualizarRegistroReprocessado(id, r) {
  await db.query(
    `UPDATE logs_jogo
        SET categoria = $2, acao = $3, ator_nome = $4, ator_id_fivem = $5,
            alvo_nome = $6, alvo_id_fivem = $7, valor = $8, titulo = $9, descricao = $10
      WHERE id = $1`,
    [id, r.categoria, r.acao, r.atorNome, r.atorIdFivem, r.alvoNome, r.alvoIdFivem, r.valor, r.titulo, r.descricao]
  );
}

async function idsJaGravados(messageIds) {
  if (!messageIds.length) return new Set();
  const res = await db.query('SELECT DISTINCT message_id FROM logs_jogo WHERE message_id = ANY($1)', [messageIds]);
  return new Set(res.rows.map(r => r.message_id));
}

async function buscarLogs(filtro, pagina, porPagina) {
  const { condicoes, params } = montarFiltro(filtro);
  const totalRes = await db.query(`SELECT COUNT(*)::int AS total FROM logs_jogo ${where(condicoes)}`, params);
  const total = totalRes.rows[0].total;
  const ultimaPagina = Math.max(0, Math.ceil(total / porPagina) - 1);
  const paginaEfetiva = Math.min(Math.max(0, pagina), ultimaPagina);
  const itens = await db.query(
    `SELECT id, categoria, acao, ator_nome, ator_id_fivem, alvo_nome, alvo_id_fivem, valor, descricao, ocorrido_em
       FROM logs_jogo ${where(condicoes)}
      ORDER BY ocorrido_em DESC, id DESC
      LIMIT ${Number(porPagina)} OFFSET ${paginaEfetiva * Number(porPagina)}`,
    params
  );
  return { total, pagina: paginaEfetiva, itens: itens.rows };
}

// `valor` guarda coisas de natureza diferente conforme a ação: dinheiro (R$),
// quantidade de item do baú, coins de território e pontos de honra. "Dinheiro
// movimentado" só pode somar as ações que são dinheiro de fato — antes do parser
// aprender baú/banco, todo `valor` era dinheiro e o SUM cru estava certo; agora
// somaria 5.477 tecidos com R$ 1.500.000. 'desconhecido' continua dentro: formato
// novo com "$" no texto (extrairValor) ainda é dinheiro até ganhar regra.
const ACOES_DINHEIRO = ['banco_depositou', 'banco_sacou', 'dinheiro_adicionado', 'dinheiro_conquista', 'comprou_roupa', 'comprou_item', 'desconhecido'];

async function resumo(filtro) {
  const { condicoes, params } = montarFiltro(filtro);
  params.push(ACOES_DINHEIRO);
  const res = await db.query(
    `SELECT COUNT(*)::int AS total,
            COALESCE(SUM(valor) FILTER (WHERE acao = ANY($${params.length})), 0)::float AS valor_total,
            COUNT(DISTINCT COALESCE(ator_id_fivem, ator_nome))::int AS pessoas,
            MIN(ocorrido_em) AS primeira_em,
            MAX(ocorrido_em) AS ultima_em
       FROM logs_jogo ${where(condicoes)}`,
    params
  );
  return res.rows[0];
}

async function contarPorDia(filtro) {
  const { condicoes, params } = montarFiltro(filtro);
  const res = await db.query(
    `SELECT to_char(ocorrido_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dia, COUNT(*)::int AS total
       FROM logs_jogo ${where(condicoes)}
      GROUP BY 1 ORDER BY 1`,
    params
  );
  return res.rows;
}

const COLUNAS_TOP = { categoria: 'categoria', acao: 'acao' };

async function topPorColuna(coluna, filtro, limite) {
  const expr = COLUNAS_TOP[coluna];
  if (!expr) throw new Error(`Coluna de ranking não permitida: ${coluna}`);
  const { condicoes, params } = montarFiltro(filtro);
  const res = await db.query(
    `SELECT ${expr} AS chave, COUNT(*)::int AS total
       FROM logs_jogo ${where([...condicoes, `${expr} IS NOT NULL`])}
      GROUP BY 1 ORDER BY total DESC LIMIT ${Number(limite)}`,
    params
  );
  return res.rows;
}

async function topAtores(filtro, limite) {
  const { condicoes, params } = montarFiltro(filtro);
  const res = await db.query(
    `SELECT MAX(ator_id_fivem) AS id, MAX(ator_nome) AS nome, COUNT(*)::int AS total
       FROM logs_jogo ${where([...condicoes, '(ator_id_fivem IS NOT NULL OR ator_nome IS NOT NULL)'])}
      GROUP BY COALESCE(ator_id_fivem, ator_nome)
      ORDER BY total DESC LIMIT ${Number(limite)}`,
    params
  );
  return res.rows;
}

async function valoresDistintos(coluna, prefixo) {
  const expr = COLUNAS_TOP[coluna];
  if (!expr) throw new Error(`Coluna não permitida: ${coluna}`);
  const res = await db.query(
    `SELECT ${expr} AS valor FROM logs_jogo
      WHERE ${expr} IS NOT NULL AND ${expr} ILIKE $1
      GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 25`,
    [`${escaparLike(prefixo)}%`]
  );
  return res.rows.map(r => r.valor);
}

async function ultimaAtividadePorIds(ids) {
  if (!ids.length) return new Map();
  const res = await db.query(
    `SELECT id, MAX(ocorrido_em) AS ultima FROM (
       SELECT ator_id_fivem AS id, ocorrido_em FROM logs_jogo WHERE ator_id_fivem = ANY($1)
       UNION ALL
       SELECT alvo_id_fivem AS id, ocorrido_em FROM logs_jogo WHERE alvo_id_fivem = ANY($1)
     ) t GROUP BY id`,
    [ids]
  );
  return new Map(res.rows.map(r => [r.id, r.ultima]));
}

// Condições comuns a topAtoresPorAcoes/contarPorAcoes/listarPorAcoes: um
// conjunto de ações (não uma só, como montarFiltro) + período opcional. Essas
// três consultas reaproveitam a lideranca ativa, o histórico de carreira e as
// saídas da torcida — todas "algumas ações específicas, num período".
function condicoesPorAcoes(acoes, { inicio, fim } = {}) {
  const condicoes = ['acao = ANY($1)'];
  const params = [acoes];
  if (inicio) { params.push(inicio); condicoes.push(`ocorrido_em >= $${params.length}`); }
  if (fim) { params.push(fim); condicoes.push(`ocorrido_em < $${params.length}`); }
  return { condicoes, params };
}

// Ranking de quem mais AGIU (ator) entre um conjunto de ações — usado pela
// liderança ativa (convocação/patrimônio) e por "quem mais promoveu".
async function topAtoresPorAcoes(acoes, periodo, limite) {
  const { condicoes, params } = condicoesPorAcoes(acoes, periodo);
  condicoes.push('(ator_id_fivem IS NOT NULL OR ator_nome IS NOT NULL)');
  const res = await db.query(
    `SELECT MAX(ator_id_fivem) AS id, MAX(ator_nome) AS nome, COUNT(*)::int AS total
       FROM logs_jogo WHERE ${condicoes.join(' AND ')}
      GROUP BY COALESCE(ator_id_fivem, ator_nome)
      ORDER BY total DESC LIMIT ${Number(limite)}`,
    params
  );
  return res.rows;
}

// Quantidade por ator, restrita a uma lista FECHADA de IDs — diferente de
// topAtoresPorAcoes (só quem agiu, top N): aqui quem não aparecer no
// resultado é porque teve 0 no período, e quem chama precisa saber disso
// (ex.: recrutador com o cargo que não recrutou nada no período).
async function contarPorAtorNaLista(acoes, idsFivem, periodo) {
  if (!idsFivem.length) return [];
  const { condicoes, params } = condicoesPorAcoes(acoes, periodo);
  params.push(idsFivem);
  condicoes.push(`ator_id_fivem = ANY($${params.length})`);
  const res = await db.query(
    `SELECT ator_id_fivem AS id, COUNT(*)::int AS total
       FROM logs_jogo WHERE ${condicoes.join(' AND ')}
      GROUP BY ator_id_fivem`,
    params
  );
  return res.rows;
}

// Pares recrutador→recrutado (ator/alvo de jogador_recrutou), restrito a uma
// lista de recrutadores — base pra taxa de retenção (cruza com
// primeiraSaidaPorAlvo): pra cada recrutamento, é preciso saber QUEM foi
// recrutado e QUANDO, pra depois checar se aquele alvo saiu logo em seguida.
async function recrutamentosDetalhados(idsFivem, periodo) {
  if (!idsFivem.length) return [];
  const { condicoes, params } = condicoesPorAcoes(['jogador_recrutou'], periodo);
  params.push(idsFivem);
  condicoes.push(`ator_id_fivem = ANY($${params.length})`);
  condicoes.push('alvo_id_fivem IS NOT NULL');
  const res = await db.query(
    `SELECT ator_id_fivem AS recrutador, alvo_id_fivem AS recrutado, ocorrido_em
       FROM logs_jogo WHERE ${condicoes.join(' AND ')}`,
    params
  );
  return res.rows;
}

// Primeira saída (de um conjunto de ações, tipicamente ACOES_CHURN) de cada
// ID de uma lista — não restrito a período: retenção pergunta "saiu depois
// de recrutado", não "saiu dentro da janela do painel", então a saída pode
// cair fora do período escolhido no select e ainda assim contar.
async function primeiraSaidaPorAlvo(idsAlvo, acoes) {
  if (!idsAlvo.length) return [];
  const res = await db.query(
    `SELECT alvo_id_fivem AS id, MIN(ocorrido_em) AS saida_em
       FROM logs_jogo WHERE acao = ANY($1) AND alvo_id_fivem = ANY($2)
      GROUP BY alvo_id_fivem`,
    [acoes, idsAlvo]
  );
  return res.rows;
}

// Quantidade por ação dentro de um conjunto — "quantas de cada tipo" (ex.:
// sede trancou vs destrancou, saiu vs foi expulso).
async function contarPorAcoes(acoes, periodo) {
  const { condicoes, params } = condicoesPorAcoes(acoes, periodo);
  const res = await db.query(
    `SELECT acao, COUNT(*)::int AS total FROM logs_jogo WHERE ${condicoes.join(' AND ')}
      GROUP BY acao ORDER BY total DESC`,
    params
  );
  return res.rows;
}

// Últimos eventos de um conjunto de ações, mais recentes primeiro — usado
// pela lista de "últimas saídas" em montarEmbedChurn e por todo estado
// reconstruído de add/remove (analises.js: restrições, tags, advertências),
// que depende de saber qual dos dois eventos veio por último. Por isso o
// desempate por message_id/embed_indice: vários eventos podem cair no mesmo
// `ocorrido_em` (é a hora da MENSAGEM, e uma mensagem carrega vários eventos —
// ver o comentário de estadoDosJogadores), e sem ele um "adicionou" e um
// "removeu" do mesmo jogador na mesma mensagem podem voltar invertidos.
async function listarPorAcoes(acoes, periodo, limite) {
  const { condicoes, params } = condicoesPorAcoes(acoes, periodo);
  const res = await db.query(
    `SELECT acao, ator_nome, ator_id_fivem, alvo_nome, alvo_id_fivem, valor, titulo, descricao, ocorrido_em
       FROM logs_jogo WHERE ${condicoes.join(' AND ')}
      ORDER BY ocorrido_em DESC, message_id::bigint DESC, embed_indice DESC
      LIMIT ${Number(limite)}`,
    params
  );
  return res.rows;
}

// Quando chegou o último log de um conjunto de ações — é o que deixa um painel
// avisar "nenhum log desse tipo desde X" em vez de mostrar zero como se nada
// tivesse acontecido (o canal logs-liderança parou em 2026-07 e ninguém notou).
async function ultimaOcorrencia(acoes) {
  const res = await db.query('SELECT MAX(ocorrido_em) AS ultima FROM logs_jogo WHERE acao = ANY($1)', [acoes]);
  return res.rows[0]?.ultima ?? null;
}

// Quantos eventos de um conjunto de ações por dia — sparkline dos painéis novos
// (caixa, baú), equivalente de contarPorDia pra mais de uma ação.
async function contarPorDiaPorAcoes(acoes, periodo) {
  const { condicoes, params } = condicoesPorAcoes(acoes, periodo);
  const res = await db.query(
    `SELECT to_char(ocorrido_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dia, COUNT(*)::int AS total
       FROM logs_jogo WHERE ${condicoes.join(' AND ')}
      GROUP BY 1 ORDER BY 1`,
    params
  );
  return res.rows;
}

// Quantidade e soma de `valor` por ação — o painel de caixa vive disso
// (quanto entrou no banco, quanto saiu, quanto os sócios gastaram).
async function somarPorAcoes(acoes, periodo) {
  const { condicoes, params } = condicoesPorAcoes(acoes, periodo);
  const res = await db.query(
    `SELECT acao, COUNT(*)::int AS total, COALESCE(SUM(valor), 0)::float AS soma
       FROM logs_jogo WHERE ${condicoes.join(' AND ')}
      GROUP BY acao ORDER BY soma DESC, total DESC`,
    params
  );
  return res.rows;
}

// Ranking por DINHEIRO (não por quantidade de eventos, como topAtoresPorAcoes):
// quem mais depositou, quem mais gastou.
async function topAtoresPorValor(acoes, periodo, limite) {
  const { condicoes, params } = condicoesPorAcoes(acoes, periodo);
  condicoes.push('valor IS NOT NULL', '(ator_id_fivem IS NOT NULL OR ator_nome IS NOT NULL)');
  const res = await db.query(
    `SELECT MAX(ator_id_fivem) AS id, MAX(ator_nome) AS nome,
            COUNT(*)::int AS total, COALESCE(SUM(valor), 0)::float AS soma
       FROM logs_jogo WHERE ${condicoes.join(' AND ')}
      GROUP BY COALESCE(ator_id_fivem, ator_nome)
      ORDER BY soma DESC LIMIT ${Number(limite)}`,
    params
  );
  return res.rows;
}

// Último apelido visto pra cada ID do jogo. O log do baú manda só o ID do
// jogador (sem nome nenhum), então o nome é emprestado dos outros canais.
async function nomesPorIds(ids) {
  if (!ids.length) return new Map();
  const res = await db.query(
    `SELECT id, (array_agg(nome ORDER BY ocorrido_em DESC))[1] AS nome FROM (
       SELECT ator_id_fivem AS id, ator_nome AS nome, ocorrido_em FROM logs_jogo
        WHERE ator_id_fivem = ANY($1) AND ator_nome IS NOT NULL
       UNION ALL
       SELECT alvo_id_fivem AS id, alvo_nome AS nome, ocorrido_em FROM logs_jogo
        WHERE alvo_id_fivem = ANY($1) AND alvo_nome IS NOT NULL
     ) t GROUP BY id`,
    [ids]
  );
  return new Map(res.rows.map(r => [r.id, r.nome]));
}

// Contagem, soma e último evento por ALVO e ação — o painel de território vive
// disso (horas dominadas e conquistas por território, em `alvo_nome`).
async function resumoPorAlvo(acoes, periodo) {
  const { condicoes, params } = condicoesPorAcoes(acoes, periodo);
  condicoes.push('alvo_nome IS NOT NULL');
  const res = await db.query(
    `SELECT alvo_nome AS alvo, acao, COUNT(*)::int AS total,
            COALESCE(SUM(valor), 0)::float AS soma, MAX(ocorrido_em) AS ultima
       FROM logs_jogo WHERE ${condicoes.join(' AND ')}
      GROUP BY 1, 2`,
    params
  );
  return res.rows;
}

// Contagem por dia E por ação, separadas (diferente de contarPorDiaPorAcoes,
// que soma tudo junto) — o painel de território usa pra ter, no mesmo eixo de
// dias, "horas de domínio" (1 log coins_dominacao = 1h) e "conquistas" como
// duas séries distintas.
async function porDiaEAcao(acoes, periodo) {
  const { condicoes, params } = condicoesPorAcoes(acoes, periodo);
  const res = await db.query(
    `SELECT to_char(ocorrido_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dia, acao, COUNT(*)::int AS total
       FROM logs_jogo WHERE ${condicoes.join(' AND ')}
      GROUP BY 1, 2 ORDER BY 1`,
    params
  );
  return res.rows;
}

// Conquistas por DIA e por TERRITÓRIO (não agregado como porDiaEAcao) — a
// linha "conquistas" do gráfico soma TODOS os territórios; isso aqui é o que
// diz se um dia com 5 conquistas foi 5 territórios diferentes (sem disputa)
// ou o MESMO território retomado 5x (disputa ativa de verdade — pedido do
// usuário em 2026-09-15). `disputaPorDia`/`serieTerritorioPorDia` (ver
// painelTerritorioInteracoes.js) transformam isso na série extra plotada no
// gráfico e no destaque textual, a partir da mesma consulta.
async function conquistasPorDiaEAlvo(periodo) {
  const { condicoes, params } = condicoesPorAcoes(['coins_conquista'], periodo);
  condicoes.push('alvo_nome IS NOT NULL');
  const res = await db.query(
    `SELECT to_char(ocorrido_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dia, alvo_nome AS alvo, COUNT(*)::int AS total
       FROM logs_jogo WHERE ${condicoes.join(' AND ')}
      GROUP BY 1, 2 ORDER BY 1`,
    params
  );
  return res.rows;
}

// Estado atual de cada fechadura numa consulta só: sem isso o painel teria que
// ler os 15 mil eventos de patrimônio pra ficar com uma dezena de linhas.
// `chave` junta as duas formas que o jogo usa (ações próprias de sede/portão e
// o nome em alvo_nome das demais — ver analises.fechaduraDoEvento, que refaz a
// mesma conta pra montar a linha).
async function ultimoPorFechadura(acoes) {
  const res = await db.query(
    `SELECT DISTINCT ON (chave) acao, ator_nome, ator_id_fivem, alvo_nome, ocorrido_em
       FROM (
         SELECT CASE
                  WHEN acao LIKE 'sede\\_%' THEN 'sede'
                  WHEN acao LIKE 'portao\\_%' THEN 'portão'
                  ELSE lower(trim(alvo_nome))
                END AS chave,
                acao, ator_nome, ator_id_fivem, alvo_nome, ocorrido_em, message_id, embed_indice
           FROM logs_jogo WHERE acao = ANY($1)
       ) t
      WHERE chave IS NOT NULL AND chave <> ''
      ORDER BY chave, ocorrido_em DESC, message_id::bigint DESC, embed_indice DESC`,
    [acoes]
  );
  return res.rows;
}

const ACOES_BAU = ['bau_guardou', 'bau_removeu'];

// Saldo LÍQUIDO por baú e item (guardou − removeu). Não é estoque: o jogo nunca
// informa o que já estava dentro, então isso vale "desde o primeiro log lido" —
// `desde` volta junto justamente pra o painel poder dizer isso na cara.
// O baú sai do título ("Guardou [GDF Sócio]"), que é o único lugar onde o jogo
// diz de qual compartimento se trata.
async function saldoBau() {
  const res = await db.query(
    `SELECT CASE
              -- "Baú de Recompensas [GDF] - Retirada (...)": o colchete é da
              -- torcida, não do compartimento (mesma conta de E.bauDoTitulo)
              WHEN titulo ILIKE 'Ba_ de Recompensas%' THEN 'Recompensas'
              ELSE substring(titulo from '\\[(.+)\\]')
            END AS bau,
            alvo_nome AS item,
            COALESCE(SUM(CASE WHEN acao = 'bau_guardou' THEN valor ELSE -valor END), 0)::float AS saldo,
            COALESCE(SUM(CASE WHEN acao = 'bau_guardou' THEN valor ELSE 0 END), 0)::float AS guardou,
            COALESCE(SUM(CASE WHEN acao = 'bau_removeu' THEN valor ELSE 0 END), 0)::float AS removeu,
            MIN(ocorrido_em) AS desde, MAX(ocorrido_em) AS ultima
       FROM logs_jogo
      WHERE acao = ANY($1) AND alvo_nome IS NOT NULL AND valor IS NOT NULL
      GROUP BY 1, 2
      ORDER BY 1, SUM(valor) DESC`,
    // Por VOLUME movimentado (guardou + removeu), não por saldo: ordenar por
    // saldo punha dezenas de camisas com saldo 0 no topo e escondia tecido,
    // maconha e cocaína, que é o que realmente circula (prévia de 2026-09-13).
    [ACOES_BAU]
  );
  return res.rows;
}

// Atividade de UM jogador no baú: totais (pra ficha rápida) + últimos eventos
// (pra auditoria — o que ele tirou/guardou por último e de qual baú).
async function atividadeBauPorId(idFivem, limiteEventos) {
  const totalRes = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN acao = 'bau_guardou' THEN valor ELSE 0 END), 0)::float AS guardou,
            COALESCE(SUM(CASE WHEN acao = 'bau_removeu' THEN valor ELSE 0 END), 0)::float AS removeu,
            COUNT(*)::int AS eventos, MIN(ocorrido_em) AS desde, MAX(ocorrido_em) AS ultima
       FROM logs_jogo WHERE acao = ANY($1) AND ator_id_fivem = $2 AND valor IS NOT NULL`,
    [ACOES_BAU, idFivem]
  );
  const eventosRes = await db.query(
    `SELECT acao, alvo_nome AS item, valor::float AS quantidade, titulo, ocorrido_em
       FROM logs_jogo WHERE acao = ANY($1) AND ator_id_fivem = $2 AND valor IS NOT NULL
      ORDER BY ocorrido_em DESC LIMIT ${Number(limiteEventos)}`,
    [ACOES_BAU, idFivem]
  );
  return { ...totalRes.rows[0], eventos: eventosRes.rows };
}

// Quem mexeu no baú num período: quanto guardou e quanto retirou cada um. Só o
// ID vem do log (ver nomesPorIds).
async function movimentoBauPorPessoa(periodo, limite) {
  const { condicoes, params } = condicoesPorAcoes(ACOES_BAU, periodo);
  condicoes.push('ator_id_fivem IS NOT NULL', 'valor IS NOT NULL');
  const res = await db.query(
    `SELECT ator_id_fivem AS id,
            COALESCE(SUM(CASE WHEN acao = 'bau_guardou' THEN valor ELSE 0 END), 0)::float AS guardou,
            COALESCE(SUM(CASE WHEN acao = 'bau_removeu' THEN valor ELSE 0 END), 0)::float AS removeu,
            COUNT(*)::int AS eventos
       FROM logs_jogo WHERE ${condicoes.join(' AND ')}
      GROUP BY 1 ORDER BY removeu DESC, guardou DESC LIMIT ${Number(limite)}`,
    params
  );
  return res.rows;
}

// Maiores retiradas de uma vez, pra auditoria (e é o mesmo critério do alerta
// de retirada grande — ver alertas.js).
async function maioresRetiradasBau(periodo, limite) {
  const { condicoes, params } = condicoesPorAcoes(['bau_removeu'], periodo);
  condicoes.push('valor IS NOT NULL');
  const res = await db.query(
    `SELECT ator_id_fivem AS id, alvo_nome AS item, valor::float AS quantidade, titulo, ocorrido_em
       FROM logs_jogo WHERE ${condicoes.join(' AND ')}
      ORDER BY valor DESC LIMIT ${Number(limite)}`,
    params
  );
  return res.rows;
}

// Extrai o baú do `titulo` em SQL — mesma conta de E.bauDoTitulo (mudar um,
// mudar o outro, ver comentário lá).
const SQL_BAU_DO_TITULO = `CASE WHEN titulo ILIKE 'Ba_ de Recompensas%' THEN 'Recompensas'
                                 ELSE substring(titulo from '\\[(.+)\\]') END`;

// Quanto cada ID GUARDOU de item de farm (config.logsJogo.farm) nos baús
// habilitados, no período — cruzado com o cargo do departamento Farm pelo
// painel-farm. Só bau_guardou conta: retirar não é trabalho de farm. Mesma
// forma de contarPorAtorNaLista (lista FECHADA de IDs, quem não aparecer
// teve 0 no período).
async function farmPorAtorNaLista(idsFivem, itens, baus, periodo) {
  if (!idsFivem.length) return [];
  const { condicoes, params } = condicoesPorAcoes(['bau_guardou'], periodo);
  params.push(idsFivem);
  condicoes.push(`ator_id_fivem = ANY($${params.length})`);
  params.push(itens);
  condicoes.push(`lower(alvo_nome) = ANY($${params.length})`);
  params.push(baus);
  condicoes.push(`${SQL_BAU_DO_TITULO} = ANY($${params.length})`);
  condicoes.push('valor IS NOT NULL');
  const res = await db.query(
    `SELECT ator_id_fivem AS id, COALESCE(SUM(valor), 0)::float AS quantidade, COUNT(*)::int AS eventos
       FROM logs_jogo WHERE ${condicoes.join(' AND ')}
      GROUP BY ator_id_fivem`,
    params
  );
  return res.rows;
}

// Ficha de farm de UM ator: últimos depósitos de item de farm, mais recente
// primeiro — mesma ideia de eventosDoAtor, já filtrado por item/baú.
async function eventosFarmDoAtor(idFivem, itens, baus, limite) {
  const res = await db.query(
    `SELECT alvo_nome AS item, valor::float AS quantidade, titulo, ocorrido_em
       FROM logs_jogo
      WHERE acao = 'bau_guardou' AND ator_id_fivem = $1 AND valor IS NOT NULL
        AND lower(alvo_nome) = ANY($2) AND ${SQL_BAU_DO_TITULO} = ANY($3)
      ORDER BY ocorrido_em DESC LIMIT ${Number(limite)}`,
    [idFivem, itens, baus]
  );
  return res.rows;
}

// Quanto foi guardado por ITEM de farm, quebrado por ator — o painel-farm
// soma por item pra "quem produz mais o quê" (ranking por item, não só o
// total por pessoa) e acha o "top farmer" de cada item a partir da mesma
// linha, sem consulta extra.
async function farmPorItemEAtor(itens, baus, periodo) {
  const { condicoes, params } = condicoesPorAcoes(['bau_guardou'], periodo);
  params.push(itens);
  condicoes.push(`lower(alvo_nome) = ANY($${params.length})`);
  params.push(baus);
  condicoes.push(`${SQL_BAU_DO_TITULO} = ANY($${params.length})`);
  condicoes.push('valor IS NOT NULL', 'ator_id_fivem IS NOT NULL');
  const res = await db.query(
    `SELECT lower(alvo_nome) AS item, ator_id_fivem AS id,
            COALESCE(SUM(valor), 0)::float AS quantidade, COUNT(*)::int AS eventos
       FROM logs_jogo WHERE ${condicoes.join(' AND ')}
      GROUP BY 1, 2`,
    params
  );
  return res.rows;
}

// Total guardado de item de farm por DIA (fuso São Paulo) — mesmo shape de
// contarPorDiaPorAcoes ({dia, total}), pra reaproveitar
// estatisticas.js#serieDiaria (zero-fill) e alimentar o gráfico de tendência
// do painel-farm (ver graficoFarmPorDia.js).
async function farmPorDia(itens, baus, periodo) {
  const { condicoes, params } = condicoesPorAcoes(['bau_guardou'], periodo);
  params.push(itens);
  condicoes.push(`lower(alvo_nome) = ANY($${params.length})`);
  params.push(baus);
  condicoes.push(`${SQL_BAU_DO_TITULO} = ANY($${params.length})`);
  condicoes.push('valor IS NOT NULL');
  const res = await db.query(
    `SELECT to_char(ocorrido_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dia,
            COALESCE(SUM(valor), 0)::float AS total
       FROM logs_jogo WHERE ${condicoes.join(' AND ')}
      GROUP BY 1 ORDER BY 1`,
    params
  );
  return res.rows;
}

// Quanto UM ator já RETIROU de UM item de farm HOJE (fuso São Paulo) nos
// baús habilitados — base do limite diário parametrizável (ver
// painelFarmInteracoes.js#limitesEfetivosFarm e alertas.js#retirada_suspeita_farm).
// `periodoHoje` é sempre estatisticas.js#resolverPeriodo('hoje'); quem chama
// resolve, essa função só filtra pelo intervalo que vier.
async function farmRetiradoHojePorItem(idFivem, item, baus, periodoHoje) {
  const { condicoes, params } = condicoesPorAcoes(['bau_removeu'], periodoHoje);
  params.push(idFivem);
  condicoes.push(`ator_id_fivem = $${params.length}`);
  params.push(item);
  condicoes.push(`lower(alvo_nome) = $${params.length}`);
  params.push(baus);
  condicoes.push(`${SQL_BAU_DO_TITULO} = ANY($${params.length})`);
  condicoes.push('valor IS NOT NULL');
  const res = await db.query(
    `SELECT COALESCE(SUM(valor), 0)::float AS total FROM logs_jogo WHERE ${condicoes.join(' AND ')}`,
    params
  );
  return res.rows[0].total;
}

// Últimos eventos de um conjunto de ações em que o ID dado foi quem AGIU —
// "ficha do jogador" de qualquer canal-painel interativo cujo protagonista é
// quem mexeu (caixa, fechaduras, auditoria). Genérico de propósito: evita uma
// consulta bespoke por domínio pra fazer a mesma pergunta.
async function eventosDoAtor(idFivem, acoes, limite) {
  const res = await db.query(
    `SELECT acao, ator_nome, ator_id_fivem, alvo_nome, alvo_id_fivem, valor, titulo, descricao, ocorrido_em
       FROM logs_jogo WHERE acao = ANY($1) AND ator_id_fivem = $2
      ORDER BY ocorrido_em DESC LIMIT ${Number(limite)}`,
    [acoes, idFivem]
  );
  return res.rows;
}

// Mesma ideia, só que pro ID que SOFREU a ação (disciplina, restrições, tags —
// domínios em que o protagonista da ficha é o alvo, não quem agiu).
async function eventosDoAlvo(idFivem, acoes, limite) {
  const res = await db.query(
    `SELECT acao, ator_nome, ator_id_fivem, alvo_nome, alvo_id_fivem, valor, titulo, descricao, ocorrido_em
       FROM logs_jogo WHERE acao = ANY($1) AND alvo_id_fivem = $2
      ORDER BY ocorrido_em DESC LIMIT ${Number(limite)}`,
    [acoes, idFivem]
  );
  return res.rows;
}

// Trilha de promoções/rebaixamentos de UM sócio (é o alvo, não o ator), em
// ordem cronológica — "de > para" fica pra quem exibir extrair da
// `descricao` (ver E.extrairMudancaCargo), não vira coluna nova.
async function historicoCargo(idFivem) {
  const res = await db.query(
    `SELECT acao, ator_nome, alvo_nome, descricao, ocorrido_em
       FROM logs_jogo
      WHERE acao IN ('promoveu_cargo', 'rebaixou_cargo') AND alvo_id_fivem = $1
      ORDER BY ocorrido_em ASC`,
    [idFivem]
  );
  return res.rows;
}

// IDs do jogo com pelo menos `minimo` aparições em todo o histórico (como
// ator OU alvo), pra achar quem interage de verdade com a torcida — usado
// pelo canal "IDs sem Discord" pra saber quem orientar a entrar no
// servidor. `nome` pega o apelido mais recente já visto pro ID (jogador
// pode ter mudado de nome no meio do caminho).
async function idsFrequentes(minimo) {
  const res = await db.query(
    `SELECT id, (array_agg(nome ORDER BY ocorrido_em DESC))[1] AS nome,
            COUNT(*)::int AS total, MAX(ocorrido_em) AS ultima
       FROM (
         SELECT ator_id_fivem AS id, ator_nome AS nome, ocorrido_em FROM logs_jogo WHERE ator_id_fivem IS NOT NULL
         UNION ALL
         SELECT alvo_id_fivem AS id, alvo_nome AS nome, ocorrido_em FROM logs_jogo WHERE alvo_id_fivem IS NOT NULL
       ) t
      GROUP BY id
     HAVING COUNT(*) >= $1
      ORDER BY total DESC`,
    [minimo]
  );
  return res.rows;
}

// Último evento de qualquer uma das ações dadas — usado pro módulo de
// segurança descobrir o estado atual de uma fechadura (o último "trancou"/
// "destrancou" registrado, qual dos dois foi por último é que decide).
async function ultimoEvento(acoes) {
  const res = await db.query(
    `SELECT acao, ator_nome, ator_id_fivem, ocorrido_em
       FROM logs_jogo
      WHERE acao = ANY($1)
      ORDER BY ocorrido_em DESC, message_id::bigint DESC, embed_indice DESC
      LIMIT 1`,
    [acoes]
  );
  return res.rows[0] ?? null;
}

const ACOES_CONEXAO = ['jogador_entrou', 'jogador_saiu'];

// O webhook do jogo manda vários eventos JUNTOS num só embed do Discord (um
// "Entrada"/"Saída" por linha), e todos eles gravam o mesmo `ocorrido_em`
// (é a hora da MENSAGEM, não do evento em si — ver ingestao.js). Dentro
// dessa mensagem, `embed_indice` é a única coisa que preserva a ordem real
// dos eventos (a ordem em que o jogo mandou pro webhook); sem desempatar por
// ele, o Postgres pode devolver entrada/saída do mesmo jogador na mesma
// mensagem em qualquer ordem — inclusive invertida — o que confundiria uma
// saída-e-reconexão de verdade (`unificarReconexoesRapidas`) com uma sessão
// nova. `message_id` desempata entre mensagens diferentes que caiam no
// mesmíssimo milissegundo (raro, mas os snowflakes do Discord são
// cronológicos, então dá pra comparar como número).
async function estadoDosJogadores(instante = new Date()) {
  const res = await db.query(
    `SELECT DISTINCT ON (ator_id_fivem) ator_id_fivem AS id, ator_nome AS nome, acao, ocorrido_em
       FROM logs_jogo
      WHERE acao = ANY($1) AND ator_id_fivem IS NOT NULL AND ocorrido_em < $2
      ORDER BY ator_id_fivem, ocorrido_em DESC, message_id::bigint DESC, embed_indice DESC`,
    [ACOES_CONEXAO, instante]
  );
  return res.rows;
}

// Eventos de entrada/saída em ordem cronológica, para reconstruir a linha do
// tempo de simultâneos dentro do período. Ver o comentário de
// estadoDosJogadores sobre por que o desempate por message_id/embed_indice é
// necessário, não só um capricho de determinismo.
// Último evento de conexão de UM id — usado antes de gerar uma entrada
// implícita (ver ingestao.montarEntradaImplicita) pra não duplicar quem já
// está com sessão aberta de verdade.
async function ultimaAcaoDeConexao(idFivem) {
  const res = await db.query(
    `SELECT acao FROM logs_jogo
      WHERE acao = ANY($1) AND ator_id_fivem = $2
      ORDER BY ocorrido_em DESC, message_id::bigint DESC, embed_indice DESC
      LIMIT 1`,
    [ACOES_CONEXAO, idFivem]
  );
  return res.rows[0]?.acao ?? null;
}

// Data do primeiro log de entrada/saída já recebido — de onde o acervo de
// registros-diários pode partir ao reconstruir o histórico inteiro (ver
// reconstruirAcervoCompleto em registrosDiarios.js). `null` só se o webhook
// nunca mandou nenhum evento de conexão.
async function primeiroEventoConexao() {
  const res = await db.query(
    'SELECT MIN(ocorrido_em) AS primeira FROM logs_jogo WHERE acao = ANY($1) AND ator_id_fivem IS NOT NULL',
    [ACOES_CONEXAO]
  );
  return res.rows[0]?.primeira ?? null;
}

async function eventosConexao(inicio, fim) {
  const res = await db.query(
    `SELECT ator_id_fivem AS id, ator_nome AS nome, acao, ocorrido_em
       FROM logs_jogo
      WHERE acao = ANY($1) AND ator_id_fivem IS NOT NULL AND ocorrido_em >= $2 AND ocorrido_em < $3
      ORDER BY ocorrido_em ASC, message_id::bigint ASC, embed_indice ASC`,
    [ACOES_CONEXAO, inicio, fim]
  );
  return res.rows;
}

// Dois formatos reais carregam patrimônio (ver E.nomePatrimonio): o webhook
// novo (`patrimonio_*`, sempre patrimônio) e o baú comum antigo (`bau_*`, que
// também carrega tecido/droga/etc — quem chama filtra pelo nome do item).
const ACOES_PATRIMONIO = ['patrimonio_guardou', 'patrimonio_removeu', 'bau_guardou', 'bau_removeu'];

// Último evento (guardou/removeu, de qualquer um dos dois formatos) por nome
// de item — decide se a peça está no baú ou "em aberto" (removida e ainda
// não devolvida). Mesma lógica de ultimoPorFechadura, mas por `alvo_nome`
// (nome do item ou código de spawn), não por fechadura fixa. Devolve TODO
// item que já passou pelas ações de baú (não só patrimônio) — quem chama
// filtra com E.nomePatrimonio, senão a linha "presidente"/"tecido" nunca sai
// da consulta e não dá pra saber quais das ~90 são patrimônio de verdade.
async function ultimoPorPatrimonio() {
  const res = await db.query(
    `SELECT DISTINCT ON (alvo_nome) acao, ator_id_fivem, alvo_nome, ocorrido_em
       FROM logs_jogo
      WHERE acao = ANY($1) AND alvo_nome IS NOT NULL
      ORDER BY alvo_nome, ocorrido_em DESC, message_id::bigint DESC, embed_indice DESC`,
    [ACOES_PATRIMONIO]
  );
  return res.rows;
}

module.exports = {
  inserirRegistro,
  desconhecidosComBruto,
  atualizarRegistroReprocessado,
  idsJaGravados,
  buscarLogs,
  resumo,
  contarPorDia,
  topCategorias: (filtro, limite) => topPorColuna('categoria', filtro, limite),
  topAcoes: (filtro, limite) => topPorColuna('acao', filtro, limite),
  topAtores,
  categoriasDistintas: prefixo => valoresDistintos('categoria', prefixo),
  acoesDistintas: prefixo => valoresDistintos('acao', prefixo),
  ultimaAtividadePorIds,
  idsFrequentes,
  estadoDosJogadores,
  eventosConexao,
  ultimaAcaoDeConexao,
  primeiroEventoConexao,
  ultimoEvento,
  topAtoresPorAcoes,
  contarPorAtorNaLista,
  recrutamentosDetalhados,
  primeiraSaidaPorAlvo,
  contarPorAcoes,
  listarPorAcoes,
  contarPorDiaPorAcoes,
  ultimaOcorrencia,
  resumoPorAlvo,
  porDiaEAcao,
  conquistasPorDiaEAlvo,
  eventosDoAtor,
  eventosDoAlvo,
  somarPorAcoes,
  topAtoresPorValor,
  nomesPorIds,
  ultimoPorFechadura,
  ultimoPorPatrimonio,
  saldoBau,
  atividadeBauPorId,
  movimentoBauPorPessoa,
  maioresRetiradasBau,
  farmPorAtorNaLista,
  eventosFarmDoAtor,
  farmPorItemEAtor,
  farmPorDia,
  farmRetiradoHojePorItem,
  historicoCargo,
};
