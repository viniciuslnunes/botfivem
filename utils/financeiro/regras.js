// Regras puras do livro-caixa (sem Discord nem banco). Dinheiro do jogo.
const { chaveDia } = require('../logsJogo/estatisticas');

const CATEGORIAS_FINANCEIRO = {
  MENSALIDADE: { rotulo: 'Mensalidade', emoji: '🪪' },
  LOJA: { rotulo: 'Loja', emoji: '🛍️' },
  EVENTO: { rotulo: 'Evento', emoji: '🎉' },
  CARAVANA: { rotulo: 'Caravana', emoji: '🚌' },
  PATRIMONIO: { rotulo: 'Patrimônio', emoji: '🗃️' },
  DOACAO: { rotulo: 'Doação', emoji: '🤝' },
  RIFA: { rotulo: 'Rifa', emoji: '🎟️' },
  OUTROS: { rotulo: 'Outros', emoji: '📦' },
};
const CATEGORIA_CHOICES = Object.entries(CATEGORIAS_FINANCEIRO).map(([value, c]) => ({ name: c.rotulo, value }));
const TIPO_LANCAMENTO_CHOICES = [{ name: 'Receita', value: 'RECEITA' }, { name: 'Despesa', value: 'DESPESA' }];

const pad = n => String(n).padStart(2, '0');

// "1.500", "1500,50", "$ 2.000", "1,500" — sempre positivo, duas casas
function parseValor(texto) {
  let s = String(texto ?? '').replace(/R\$|US\$|\$/gi, '').replace(/\s/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{3}(\.|$)/.test(s)) s = s.replace(/\./g, '');
  else s = s.replace(/,/g, '');
  const n = Math.round(Number(s) * 100) / 100;
  return Number.isFinite(n) && n > 0 && n < 1e12 ? n : null;
}

// Data de competência "DD/MM" ou "DD/MM/AAAA" (vazio = hoje em SP), entre 2000 e hoje + 1 ano
function parseDataLancamento(texto, agora = new Date()) {
  const hoje = chaveDia(agora);
  if (!texto) return hoje;
  const m = String(texto).trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (!m) return null;
  const ano = m[3] ? Number(m[3]) : Number(hoje.slice(0, 4));
  const chave = `${ano}-${pad(m[2])}-${pad(m[1])}`;
  const utc = new Date(`${chave}T12:00:00Z`);
  if (Number.isNaN(utc.getTime()) || utc.toISOString().slice(0, 10) !== chave) return null;
  const limite = new Date(new Date(`${hoje}T12:00:00Z`).getTime() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return chave >= '2000-01-01' && chave <= limite ? chave : null;
}

// Saldo é derivado: Σ receitas − Σ despesas
function resumirLancamentos(linhas) {
  const porCategoria = new Map();
  let receitas = 0;
  let despesas = 0;
  for (const l of linhas) {
    const valor = Number(l.total ?? l.valor) || 0;
    const atual = porCategoria.get(l.categoria) ?? { categoria: l.categoria, receitas: 0, despesas: 0 };
    if (l.tipo === 'RECEITA') { receitas += valor; atual.receitas += valor; }
    else { despesas += valor; atual.despesas += valor; }
    porCategoria.set(l.categoria, atual);
  }
  const arredondar = n => Math.round(n * 100) / 100;
  return {
    receitas: arredondar(receitas),
    despesas: arredondar(despesas),
    saldo: arredondar(receitas - despesas),
    porCategoria: [...porCategoria.values()]
      .map(c => ({ ...c, receitas: arredondar(c.receitas), despesas: arredondar(c.despesas) }))
      .sort((a, b) => (b.receitas + b.despesas) - (a.receitas + a.despesas)),
  };
}

function rotuloCategoria(categoria) {
  const c = CATEGORIAS_FINANCEIRO[categoria] ?? CATEGORIAS_FINANCEIRO.OUTROS;
  return `${c.emoji} ${c.rotulo}`;
}

module.exports = {
  CATEGORIAS_FINANCEIRO,
  CATEGORIA_CHOICES,
  TIPO_LANCAMENTO_CHOICES,
  parseValor,
  parseDataLancamento,
  resumirLancamentos,
  rotuloCategoria,
};
