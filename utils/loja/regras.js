// Regras puras da loja (sem Discord nem banco).

const TAMANHO_UNICO = 'UN';
const ORDEM_TAMANHOS = ['PP', 'P', 'M', 'G', 'GG', 'EXG'];
const MAX_UNIDADES_POR_PEDIDO = 10;
const MAX_PEDIDOS_ABERTOS = 3;

// "P:10, M:5, G:0" ou só "20" (produto sem tamanho)
function parseEstoque(texto) {
  const t = String(texto ?? '').trim().toUpperCase();
  if (/^\d+$/.test(t)) return { [TAMANHO_UNICO]: Number(t) };
  const estoque = {};
  for (const parte of t.split(/[,;]/).map(p => p.trim()).filter(Boolean)) {
    const m = parte.match(/^([A-Z]{1,4})\s*[:=]\s*(\d+)$/);
    if (!m) return null;
    estoque[m[1]] = Number(m[2]);
  }
  return Object.keys(estoque).length ? estoque : null;
}

function tamanhosOrdenados(estoque) {
  const ordem = t => (ORDEM_TAMANHOS.includes(t) ? ORDEM_TAMANHOS.indexOf(t) : ORDEM_TAMANHOS.length);
  return Object.keys(estoque ?? {}).sort((a, b) => ordem(a) - ordem(b) || a.localeCompare(b));
}

function tamanhosDisponiveis(estoque) {
  return tamanhosOrdenados(estoque).filter(t => Number(estoque[t]) > 0);
}

function formatarEstoque(estoque) {
  const tamanhos = tamanhosOrdenados(estoque);
  if (!tamanhos.length) return 'SEM ESTOQUE';
  if (tamanhos.length === 1 && tamanhos[0] === TAMANHO_UNICO) return `${estoque[TAMANHO_UNICO]} un.`;
  return tamanhos.map(t => `${t}: ${estoque[t]}`).join(' · ');
}

function rotuloTamanho(tamanho) {
  return tamanho === TAMANHO_UNICO ? 'ÚNICO' : tamanho;
}

function validarPedido({ estoque, tamanho, quantidade }) {
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > MAX_UNIDADES_POR_PEDIDO) {
    return { ok: false, mensagem: `❌ QUANTIDADE INVÁLIDA (DE 1 A ${MAX_UNIDADES_POR_PEDIDO} UNIDADES POR PEDIDO).` };
  }
  const disponivel = Number(estoque?.[tamanho] ?? 0);
  if (disponivel <= 0) return { ok: false, mensagem: '❌ ESTE TAMANHO ACABOU DE ESGOTAR.' };
  if (quantidade > disponivel) return { ok: false, mensagem: `❌ SÓ RESTAM ${disponivel} UNIDADE${disponivel !== 1 ? 'S' : ''} NESTE TAMANHO.` };
  return { ok: true };
}

function ajustarEstoque(estoque, tamanho, delta) {
  return { ...estoque, [tamanho]: Math.max(0, Number(estoque?.[tamanho] ?? 0) + delta) };
}

function totalPedido(preco, quantidade) {
  return Math.round(Number(preco) * quantidade * 100) / 100;
}

module.exports = {
  TAMANHO_UNICO,
  MAX_UNIDADES_POR_PEDIDO,
  MAX_PEDIDOS_ABERTOS,
  parseEstoque,
  tamanhosOrdenados,
  tamanhosDisponiveis,
  formatarEstoque,
  rotuloTamanho,
  validarPedido,
  ajustarEstoque,
  totalPedido,
};
