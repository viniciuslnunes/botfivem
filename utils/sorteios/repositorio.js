const db = require('../db');
const { transacao } = require('../transacao');
const { escolherNumero, hashLista } = require('./regras');

// Tudo que mexe no banco do sorteio. O que muda o resultado (sortear, ressortear,
// editar prêmio, atualizar lista) roda em transação com a linha do sorteio
// travada: dois cliques ao mesmo tempo nunca sorteiam o mesmo número nem o mesmo
// prêmio. Cada número que sai vai para `sorteio_sorteadas` (auditoria + índice
// único): número substituído por ressorteio continua "queimado".

const COLUNAS = `id, titulo, origem, dia::text AS dia, total_numeros, status, criado_por, canal_id, message_id,
  criado_em, concluido_em, lista_hash, min_minutos, excluir_dias, excluidos_minimo, excluidos_recentes,
  historico_canal_id, historico_message_id, lembretes_entrega`;

async function inserirParticipantes(c, sorteioId, lista) {
  for (const p of lista) {
    await c.query(
      'INSERT INTO sorteio_participantes (sorteio_id, numero, id_jogo, nome, discord_id) VALUES ($1, $2, $3, $4, $5)',
      [sorteioId, p.numero, p.id, p.nome, p.discordId ?? null]
    );
  }
}

async function criar({ titulo, origem, dia, totalNumeros, criadoPor, participantes, premios, minMinutos = null, excluirDias = null, excluidosMinimo = 0, excluidosRecentes = 0 }) {
  return transacao(async c => {
    const { rows: [s] } = await c.query(
      `INSERT INTO sorteios (titulo, origem, dia, total_numeros, criado_por, lista_hash, min_minutos, excluir_dias, excluidos_minimo, excluidos_recentes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${COLUNAS}`,
      [titulo, origem, dia ?? null, totalNumeros, criadoPor, participantes?.length ? hashLista(participantes) : null, minMinutos, excluirDias, excluidosMinimo, excluidosRecentes]
    );
    await inserirParticipantes(c, s.id, participantes ?? []);
    for (const [i, descricao] of (premios ?? []).entries()) {
      await c.query('INSERT INTO sorteio_premios (sorteio_id, ordem, descricao) VALUES ($1, $2, $3)', [s.id, i + 1, descricao]);
    }
    return s;
  });
}

async function buscar(id) {
  const { rows: [s] } = await db.query(`SELECT ${COLUNAS} FROM sorteios WHERE id = $1`, [id]);
  return s ?? null;
}

async function premios(sorteioId, executor = db) {
  const { rows } = await executor.query(
    `SELECT id, ordem, descricao, numero, sorteado_em, notificado, entregue_em, entregue_por
       FROM sorteio_premios WHERE sorteio_id = $1 ORDER BY ordem, id`,
    [sorteioId]
  );
  return rows;
}

async function participantes(sorteioId) {
  const { rows } = await db.query(
    'SELECT numero, id_jogo, nome, discord_id FROM sorteio_participantes WHERE sorteio_id = $1 ORDER BY numero',
    [sorteioId]
  );
  return rows;
}

async function participantePorNumero(sorteioId, numero) {
  const { rows: [p] } = await db.query(
    'SELECT numero, id_jogo, nome, discord_id FROM sorteio_participantes WHERE sorteio_id = $1 AND numero = $2',
    [sorteioId, numero]
  );
  return p ?? null;
}

async function sorteadas(sorteioId) {
  const { rows } = await db.query(
    'SELECT premio_id, numero, tipo, por, restantes, em FROM sorteio_sorteadas WHERE sorteio_id = $1 ORDER BY id',
    [sorteioId]
  );
  return rows;
}

async function abertos() {
  const { rows } = await db.query(`SELECT ${COLUNAS} FROM sorteios WHERE status = 'ABERTO' ORDER BY id`);
  return rows;
}

async function gravarMensagem(id, { canalId, messageId }) {
  await db.query('UPDATE sorteios SET canal_id = $2, message_id = $3 WHERE id = $1', [id, canalId, messageId]);
}

async function gravarHistorico(id, { canalId, messageId }) {
  await db.query('UPDATE sorteios SET historico_canal_id = $2, historico_message_id = $3 WHERE id = $1', [id, canalId, messageId]);
}

// Trava a linha do sorteio e confere que ainda está aberto (erro 'fechado' se não)
async function travarAberto(c, id) {
  const { rows: [s] } = await c.query(`SELECT ${COLUNAS} FROM sorteios WHERE id = $1 FOR UPDATE`, [id]);
  if (!s) return { erro: 'nao_encontrado' };
  if (s.status !== 'ABERTO') return { erro: 'fechado', sorteio: s };
  return { sorteio: s };
}

async function numerosQueimados(c, id) {
  const { rows } = await c.query('SELECT numero FROM sorteio_sorteadas WHERE sorteio_id = $1', [id]);
  return rows.map(r => r.numero);
}

// Registra o número na trilha e devolve quantos ainda restam depois dele
async function registrarSaida(c, sorteio, premioId, numero, tipo, por, queimadosAntes) {
  const restantes = sorteio.total_numeros - queimadosAntes.length - 1;
  await c.query(
    'INSERT INTO sorteio_sorteadas (sorteio_id, premio_id, numero, tipo, por, restantes) VALUES ($1, $2, $3, $4, $5, $6)',
    [sorteio.id, premioId, numero, tipo, por, restantes]
  );
  return restantes;
}

// Sorteia o próximo prêmio pendente entre os números que ainda não saíram.
async function sortearProximo(id, por, rand) {
  return transacao(async c => {
    const t = await travarAberto(c, id);
    if (t.erro) return t;
    const lista = await premios(id, c);
    const pendente = lista.find(p => p.numero == null);
    if (!pendente) return { erro: 'sem_premio' };
    const queimados = await numerosQueimados(c, id);
    const numero = escolherNumero(t.sorteio.total_numeros, queimados, rand);
    if (numero == null) return { erro: 'sem_numeros' };
    await c.query('UPDATE sorteio_premios SET numero = $2, sorteado_em = now() WHERE id = $1', [pendente.id, numero]);
    const restantes = await registrarSaida(c, t.sorteio, pendente.id, numero, 'SORTEIO', por, queimados);
    return { premio: { ...pendente, numero }, numero, restantes };
  });
}

// Ganhador ausente: o prêmio ganha OUTRO número. O anterior continua queimado
// (não volta ao globo), então ninguém sai duas vezes nem o resultado se repete.
async function ressortear(id, premioId, por, rand) {
  return transacao(async c => {
    const t = await travarAberto(c, id);
    if (t.erro) return t;
    const lista = await premios(id, c);
    const premio = lista.find(p => String(p.id) === String(premioId));
    if (!premio || premio.numero == null) return { erro: 'nao_sorteado' };
    if (premio.entregue_em) return { erro: 'ja_entregue' };
    const queimados = await numerosQueimados(c, id);
    const numero = escolherNumero(t.sorteio.total_numeros, queimados, rand);
    if (numero == null) return { erro: 'sem_numeros' };
    await c.query('UPDATE sorteio_premios SET numero = NULL WHERE id = $1', [premio.id]); // libera o índice único parcial
    await c.query('UPDATE sorteio_premios SET numero = $2, sorteado_em = now(), notificado = false WHERE id = $1', [premio.id, numero]);
    const restantes = await registrarSaida(c, t.sorteio, premio.id, numero, 'RESSORTEIO', por, queimados);
    return { premio: { ...premio, numero }, anterior: premio.numero, numero, restantes };
  });
}

// Adiciona prêmios ao fim da lista (só com o sorteio aberto; nunca mais prêmios que números)
async function adicionarPremios(id, descricoes, maxPremios) {
  return transacao(async c => {
    const t = await travarAberto(c, id);
    if (t.erro) return t;
    const lista = await premios(id, c);
    if (lista.length + descricoes.length > maxPremios) return { erro: 'excede', limite: maxPremios, atuais: lista.length };
    let ordem = lista.reduce((m, p) => Math.max(m, p.ordem), 0);
    for (const d of descricoes) await c.query('INSERT INTO sorteio_premios (sorteio_id, ordem, descricao) VALUES ($1, $2, $3)', [id, ++ordem, d]);
    return { adicionados: descricoes.length };
  });
}

// Prêmio já sorteado não muda nem sai: o resultado publicado é definitivo
async function editarPremio(id, premioId, descricao) {
  return transacao(async c => {
    const t = await travarAberto(c, id);
    if (t.erro) return t;
    const r = await c.query('UPDATE sorteio_premios SET descricao = $3 WHERE id = $2 AND sorteio_id = $1 AND numero IS NULL', [id, premioId, descricao]);
    return r.rowCount ? { ok: true } : { erro: 'ja_sorteado' };
  });
}

async function removerPremio(id, premioId) {
  return transacao(async c => {
    const t = await travarAberto(c, id);
    if (t.erro) return t;
    const r = await c.query('DELETE FROM sorteio_premios WHERE id = $2 AND sorteio_id = $1 AND numero IS NULL', [id, premioId]);
    return r.rowCount ? { ok: true } : { erro: 'ja_sorteado' };
  });
}

// Troca a lista de participantes (lista do dia mudou ou regra de elegibilidade mudou).
// Só antes do primeiro sorteio.
async function substituirParticipantes(id, lista, { excluirDias, excluidosMinimo = 0, excluidosRecentes = 0 } = {}) {
  return transacao(async c => {
    const t = await travarAberto(c, id);
    if (t.erro) return t;
    if ((await numerosQueimados(c, id)).length) return { erro: 'ja_sorteou' };
    await c.query('DELETE FROM sorteio_participantes WHERE sorteio_id = $1', [id]);
    await inserirParticipantes(c, id, lista);
    await c.query(
      `UPDATE sorteios SET total_numeros = $2, lista_hash = $3, excluir_dias = $4, excluidos_minimo = $5, excluidos_recentes = $6 WHERE id = $1`,
      [id, lista.length, hashLista(lista), excluirDias === undefined ? t.sorteio.excluir_dias : excluirDias, excluidosMinimo, excluidosRecentes]
    );
    return { total: lista.length };
  });
}

// Conclui só com todos os prêmios sorteados (guarda no SQL: status ABERTO)
async function concluir(id) {
  return transacao(async c => {
    const t = await travarAberto(c, id);
    if (t.erro) return t;
    const lista = await premios(id, c);
    if (!lista.length) return { erro: 'sem_premio' };
    if (lista.some(p => p.numero == null)) return { erro: 'pendentes', pendentes: lista.filter(p => p.numero == null).length };
    await c.query("UPDATE sorteios SET status = 'CONCLUIDO', concluido_em = now() WHERE id = $1", [id]);
    return { ok: true };
  });
}

async function cancelar(id) {
  const r = await db.query("UPDATE sorteios SET status = 'CANCELADO', concluido_em = now() WHERE id = $1 AND status = 'ABERTO'", [id]);
  return r.rowCount > 0;
}

async function marcarNotificado(premioId) {
  await db.query('UPDATE sorteio_premios SET notificado = true WHERE id = $1', [premioId]);
}

// Entrega: só de sorteio concluído e uma vez por prêmio
async function marcarEntrega(id, premioId, por) {
  const r = await db.query(
    `UPDATE sorteio_premios SET entregue_em = now(), entregue_por = $3
      WHERE id = $2 AND sorteio_id = $1 AND entregue_em IS NULL AND numero IS NOT NULL
        AND EXISTS (SELECT 1 FROM sorteios WHERE id = $1 AND status = 'CONCLUIDO')`,
    [id, premioId, por]
  );
  return r.rowCount > 0;
}

// Sorteios concluídos com prêmio ainda por entregar (lembrete e painel)
async function comEntregaPendente() {
  const { rows } = await db.query(
    `SELECT DISTINCT s.id FROM sorteios s JOIN sorteio_premios p ON p.sorteio_id = s.id
      WHERE s.status = 'CONCLUIDO' AND p.entregue_em IS NULL ORDER BY s.id`
  );
  return rows.map(r => r.id);
}

async function contarLembrete(id) {
  await db.query('UPDATE sorteios SET lembretes_entrega = lembretes_entrega + 1 WHERE id = $1', [id]);
}

// Quem ganhou em sorteio CONCLUÍDO nos últimos `dias` dias (para "dar chance a outros").
// O ID do jogo troca por season: devolve também Discord e nome para correlacionar.
async function ganhadoresRecentes(dias) {
  const { rows } = await db.query(
    `SELECT DISTINCT pa.id_jogo, pa.nome, pa.discord_id
       FROM sorteios s
       JOIN sorteio_premios pr ON pr.sorteio_id = s.id AND pr.numero IS NOT NULL
       JOIN sorteio_participantes pa ON pa.sorteio_id = s.id AND pa.numero = pr.numero
      WHERE s.status = 'CONCLUIDO' AND s.concluido_em >= now() - ($1 || ' days')::interval`,
    [String(dias)]
  );
  return rows;
}

// Prêmios ganhos por uma pessoa (Discord ou ID do jogo), mais recentes primeiro
async function premiosGanhos({ discordId, idJogo }, limite = 10) {
  const { rows } = await db.query(
    `SELECT s.id AS sorteio_id, s.titulo, s.concluido_em, pr.descricao, pr.entregue_em
       FROM sorteios s
       JOIN sorteio_premios pr ON pr.sorteio_id = s.id AND pr.numero IS NOT NULL
       JOIN sorteio_participantes pa ON pa.sorteio_id = s.id AND pa.numero = pr.numero
      WHERE s.status = 'CONCLUIDO' AND (pa.discord_id = $1 OR pa.id_jogo = $2)
      ORDER BY s.concluido_em DESC LIMIT $3`,
    [discordId ?? null, idJogo ?? null, limite]
  );
  return rows;
}

module.exports = {
  criar, buscar, premios, participantes, participantePorNumero, sorteadas, abertos, gravarMensagem, gravarHistorico,
  sortearProximo, ressortear, adicionarPremios, editarPremio, removerPremio, substituirParticipantes,
  concluir, cancelar, marcarNotificado, marcarEntrega, comEntregaPendente, contarLembrete, ganhadoresRecentes, premiosGanhos,
};
