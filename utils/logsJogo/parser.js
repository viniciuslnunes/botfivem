// Parser dos "Registros de Atividade" que o FiveM publica por webhook.
// Puro (sem Discord nem banco) para ser testável. O que não reconhece continua
// sendo gravado como 'desconhecido' — nunca descartado.

function limparMarkdown(texto) {
  return String(texto ?? '').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
}

// Rodapé: "Time: Gaviões da Fiel | Categoria: lideranca • Hoje às 20:15"
function extrairCategoria(rodape) {
  const m = String(rodape ?? '').match(/Categoria:\s*([^•|\n]+)/i);
  return m ? m[1].trim().toLowerCase() : null;
}

function extrairAtorDoTitulo(titulo) {
  const m = limparMarkdown(titulo).match(/^Registro de Atividade:\s*(.+)$/i);
  return m ? m[1].trim() : null;
}

function extrairIds(texto) {
  return [...limparMarkdown(texto).matchAll(/\(\s*ID:\s*(\d+)\s*\)/gi)].map(m => m[1]);
}

function normalizarNumero(bruto) {
  let s = bruto.replace(/\s/g, '');
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // 1.500,00
  else if (/\.\d{3}(\.|$)/.test(s)) s = s.replace(/\./g, '');          // 1.500
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Dinheiro do jogo: "$ 1.500", "R$ 1.500,00", "$2500"
function extrairValor(texto) {
  const m = limparMarkdown(texto).match(/(?:R\$|US\$|\$)\s?(\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i);
  return m ? normalizarNumero(m[1]) : null;
}

// Formatos conhecidos. Cada exemplo novo de log vira uma regra aqui.
const REGRAS = [
  {
    acao: 'novato_entrou',
    // "O Novato Rarin Dimarolla (ID: 8914 ) entrou na sua torcida Novato."
    teste: d => /novato/i.test(d) && /entrou na sua torcida/i.test(d),
    extrair: d => ({
      atorNome: d.match(/O Novato\s+(.+?)\s*\(\s*ID:/i)?.[1]?.trim() ?? null,
      atorIdFivem: d.match(/\(\s*ID:\s*(\d+)\s*\)/i)?.[1] ?? null,
    }),
  },
];

function parseRegistro(embed) {
  const titulo = limparMarkdown(embed?.title);
  const descricao = limparMarkdown(embed?.description);
  const campos = limparMarkdown((embed?.fields ?? []).map(f => `${f.name}: ${f.value}`).join(' | '));
  const textoCompleto = [descricao, campos].filter(Boolean).join(' | ');

  const base = {
    categoria: extrairCategoria(embed?.footer?.text),
    titulo: titulo || null,
    descricao: textoCompleto || null,
    atorNome: extrairAtorDoTitulo(titulo),
    atorIdFivem: null,
    alvoNome: null,
    alvoIdFivem: null,
    valor: extrairValor(textoCompleto),
  };

  const regra = REGRAS.find(r => r.teste(descricao));
  if (regra) return { ...base, ...regra.extrair(descricao), acao: regra.acao };

  // Genérico: primeiro ID é de quem agiu, segundo é do alvo
  const ids = extrairIds(textoCompleto);
  return { ...base, atorIdFivem: ids[0] ?? null, alvoIdFivem: ids[1] ?? null, acao: 'desconhecido' };
}

module.exports = { parseRegistro, limparMarkdown, extrairCategoria, extrairValor };
