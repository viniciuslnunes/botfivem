const db = require('../db');
const { transacao } = require('../transacao');

async function criarItem(i) {
  const { rows } = await db.query(
    `INSERT INTO patrimonio_itens (nome, categoria, subtipo, quantidade, localizacao, responsavel_id, foto_ref, observacao, criado_por_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [i.nome, i.categoria, i.subtipo, i.quantidade, i.localizacao, i.responsavelId, i.fotoRef, i.observacao, i.criadoPorId]
  );
  return rows[0];
}

const CAMPOS = { nome: 'nome', categoria: 'categoria', subtipo: 'subtipo', quantidade: 'quantidade', localizacao: 'localizacao', responsavelId: 'responsavel_id', fotoRef: 'foto_ref', observacao: 'observacao' };

async function editarItem(id, campos) {
  const sets = [];
  const params = [id];
  for (const [chave, valor] of Object.entries(campos)) {
    if (valor === undefined || !CAMPOS[chave]) continue;
    params.push(valor);
    sets.push(`${CAMPOS[chave]} = $${params.length}`);
  }
  if (!sets.length) return buscarItem(id);
  const { rows } = await db.query(`UPDATE patrimonio_itens SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  return rows[0] ?? null;
}

// Item com o empréstimo aberto (se houver) e o evento para o qual saiu
async function buscarItem(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const { rows } = await db.query(
    `SELECT i.*, e.id AS emprestimo_id, e.discord_id AS emprestimo_discord_id, e.saiu_em AS emprestimo_saiu_em,
            e.foto_saida_ref AS emprestimo_foto_saida_ref, e.evento_id AS emprestimo_evento_id
       FROM patrimonio_itens i
       LEFT JOIN patrimonio_emprestimos e ON e.item_id = i.id AND e.status = 'ABERTO'
      WHERE i.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

// categorias null = todas; lista vazia = nenhuma
async function listarItens({ categorias, incluirBaixados = false }) {
  if (Array.isArray(categorias) && !categorias.length) return [];
  const { rows } = await db.query(
    `SELECT i.*, e.discord_id AS emprestimo_discord_id
       FROM patrimonio_itens i
       LEFT JOIN patrimonio_emprestimos e ON e.item_id = i.id AND e.status = 'ABERTO'
      WHERE ($1::text[] IS NULL OR i.categoria = ANY($1))
        AND ($2 OR i.status = 'ATIVO')
      ORDER BY i.categoria, i.nome LIMIT 150`,
    [categorias, incluirBaixados]
  );
  return rows;
}

async function baixarItem(id, motivo) {
  const { rows } = await db.query(
    "UPDATE patrimonio_itens SET status = 'BAIXADO', baixado_em = now(), baixado_motivo = $2 WHERE id = $1 AND status = 'ATIVO' RETURNING *",
    [id, motivo]
  );
  return rows[0] ?? null;
}

async function abrirEmprestimo({ itemId, discordId, eventoId, fotoSaidaRef, observacao, porId }) {
  return transacao(async c => {
    const { rows: [item] } = await c.query('SELECT * FROM patrimonio_itens WHERE id = $1 FOR UPDATE', [itemId]);
    if (!item || item.status !== 'ATIVO') return { erro: '❌ ITEM NÃO ENCONTRADO OU BAIXADO.' };
    const { rows: [aberto] } = await c.query(
      "SELECT discord_id FROM patrimonio_emprestimos WHERE item_id = $1 AND status = 'ABERTO'", [itemId]);
    if (aberto) return { erro: `❌ ESTE ITEM JÁ ESTÁ FORA, COM <@${aberto.discord_id}>. REGISTRE A DEVOLUÇÃO ANTES.` };
    const { rows: [emprestimo] } = await c.query(
      `INSERT INTO patrimonio_emprestimos (item_id, discord_id, evento_id, foto_saida_ref, observacao, registrado_por_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [itemId, discordId, eventoId, fotoSaidaRef, observacao, porId]
    );
    return { item, emprestimo };
  });
}

async function fecharEmprestimo({ itemId, fotoVoltaRef, comDano, observacao }) {
  const { rows: [emprestimo] } = await db.query(
    `UPDATE patrimonio_emprestimos
        SET status = $2, foto_volta_ref = $3, voltou_em = now(),
            observacao = COALESCE($4, observacao)
      WHERE item_id = $1 AND status = 'ABERTO' RETURNING *`,
    [itemId, comDano ? 'COM_DANO' : 'DEVOLVIDO', fotoVoltaRef, observacao]
  );
  return emprestimo ?? null;
}

async function emprestimosAbertos(categorias) {
  if (Array.isArray(categorias) && !categorias.length) return [];
  const { rows } = await db.query(
    `SELECT e.*, i.nome AS item_nome, i.categoria, i.subtipo, i.quantidade, ev.titulo AS evento_titulo, ev.inicio_em AS evento_inicio_em
       FROM patrimonio_emprestimos e
       JOIN patrimonio_itens i ON i.id = e.item_id
       LEFT JOIN eventos ev ON ev.id = e.evento_id
      WHERE e.status = 'ABERTO' AND ($1::text[] IS NULL OR i.categoria = ANY($1))
      ORDER BY e.saiu_em`,
    [categorias]
  );
  return rows;
}

module.exports = { criarItem, editarItem, buscarItem, listarItens, baixarItem, abrirEmprestimo, fecharEmprestimo, emprestimosAbertos };
