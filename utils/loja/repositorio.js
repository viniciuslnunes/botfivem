const db = require('../db');
const { transacao } = require('../transacao');
const regras = require('./regras');

async function criarProduto(p) {
  const { rows } = await db.query(
    `INSERT INTO loja_produtos (nome, descricao, preco, estoque, imagem_ref, criado_por_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [p.nome, p.descricao, p.preco, p.estoque, p.imagemRef, p.criadoPorId]
  );
  return rows[0];
}

const CAMPOS_EDITAVEIS = { nome: 'nome', descricao: 'descricao', preco: 'preco', estoque: 'estoque', ativo: 'ativo', imagemRef: 'imagem_ref' };

async function editarProduto(id, campos) {
  const sets = [];
  const params = [id];
  for (const [chave, valor] of Object.entries(campos)) {
    if (valor === undefined || !CAMPOS_EDITAVEIS[chave]) continue;
    params.push(valor);
    sets.push(`${CAMPOS_EDITAVEIS[chave]} = $${params.length}`);
  }
  if (!sets.length) return buscarProduto(id);
  const { rows } = await db.query(`UPDATE loja_produtos SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  return rows[0] ?? null;
}

async function buscarProduto(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const { rows } = await db.query('SELECT * FROM loja_produtos WHERE id = $1', [id]);
  return rows[0] ?? null;
}

async function listarProdutos({ apenasAtivos = true } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM loja_produtos ${apenasAtivos ? 'WHERE ativo = true' : ''} ORDER BY ativo DESC, nome LIMIT 100`);
  return rows;
}

async function contarPedidosAbertos(discordId) {
  const { rows: [{ total }] } = await db.query(
    "SELECT COUNT(*)::int AS total FROM loja_pedidos WHERE discord_id = $1 AND status = 'PENDENTE'", [discordId]);
  return total;
}

// A reserva do estoque acontece no pedido, com o produto travado: dois pedidos
// simultâneos não vendem a mesma peça. Cancelar devolve.
async function criarPedido({ produtoId, tamanho, quantidade, discordId, observacao }) {
  return transacao(async c => {
    const { rows: [produto] } = await c.query('SELECT * FROM loja_produtos WHERE id = $1 FOR UPDATE', [produtoId]);
    if (!produto || !produto.ativo) return { erro: '❌ ESTE PRODUTO NÃO ESTÁ MAIS À VENDA.' };
    const validacao = regras.validarPedido({ estoque: produto.estoque, tamanho, quantidade });
    if (!validacao.ok) return { erro: validacao.mensagem };

    await c.query('UPDATE loja_produtos SET estoque = $2 WHERE id = $1',
      [produtoId, regras.ajustarEstoque(produto.estoque, tamanho, -quantidade)]);
    const { rows: [pedido] } = await c.query(
      `INSERT INTO loja_pedidos (discord_id, produto_id, produto_nome, tamanho, quantidade, preco_unit, total, observacao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [discordId, produtoId, produto.nome, tamanho, quantidade, produto.preco, regras.totalPedido(produto.preco, quantidade), observacao]
    );
    return { pedido, produto };
  });
}

async function gravarCanalPedido(pedidoId, canalId) {
  await db.query('UPDATE loja_pedidos SET canal_id = $2 WHERE id = $1', [pedidoId, canalId]);
}

async function buscarPedido(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const { rows } = await db.query('SELECT * FROM loja_pedidos WHERE id = $1', [id]);
  return rows[0] ?? null;
}

// Pedido só é decidido uma vez; cancelamento devolve o estoque na mesma transação
async function decidirPedido(pedidoId, status, porId) {
  return transacao(async c => {
    const { rows: [pedido] } = await c.query('SELECT * FROM loja_pedidos WHERE id = $1 FOR UPDATE', [pedidoId]);
    if (!pedido) return { erro: '❌ PEDIDO NÃO ENCONTRADO.' };
    if (pedido.status !== 'PENDENTE') return { erro: `⚠️ ESTE PEDIDO JÁ FOI ${pedido.status === 'CONFIRMADO' ? 'CONFIRMADO' : 'CANCELADO'}.`, pedido };
    if (status === 'CANCELADO') {
      const { rows: [produto] } = await c.query('SELECT estoque FROM loja_produtos WHERE id = $1 FOR UPDATE', [pedido.produto_id]);
      if (produto) {
        await c.query('UPDATE loja_produtos SET estoque = $2 WHERE id = $1',
          [pedido.produto_id, regras.ajustarEstoque(produto.estoque, pedido.tamanho, pedido.quantidade)]);
      }
    }
    const { rows: [atualizado] } = await c.query(
      'UPDATE loja_pedidos SET status = $2, decidido_por_id = $3, decidido_em = now() WHERE id = $1 RETURNING *',
      [pedidoId, status, porId]
    );
    return { pedido: atualizado };
  });
}

async function vendasDoPeriodo(inicio, fim) {
  const { rows } = await db.query(
    `SELECT produto_nome, SUM(quantidade)::int AS unidades, SUM(total)::float AS total, COUNT(*)::int AS pedidos
       FROM loja_pedidos
      WHERE status = 'CONFIRMADO' AND ($1::timestamptz IS NULL OR decidido_em >= $1) AND decidido_em < $2
      GROUP BY produto_nome ORDER BY total DESC`,
    [inicio, fim]
  );
  return rows;
}

module.exports = {
  criarProduto,
  editarProduto,
  buscarProduto,
  listarProdutos,
  contarPedidosAbertos,
  criarPedido,
  gravarCanalPedido,
  buscarPedido,
  decidirPedido,
  vendasDoPeriodo,
};
