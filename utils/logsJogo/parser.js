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
  {
    acao: 'jogador_entrou',
    // "#19200 Bigode lmzz entrou no servidor." (canal logs-painel)
    teste: d => /^#\d+\s+.+\bentrou\b.*\bservidor\b/i.test(d),
    extrair: d => {
      const m = d.match(/^#(\d+)\s+(.+?)\s+entrou\b/i);
      return { atorIdFivem: m?.[1] ?? null, atorNome: m?.[2]?.trim() ?? null, categoria: 'conexao' };
    },
  },
  {
    acao: 'jogador_saiu',
    // "#19200 Bigode lmzz saiu do servidor." (canal logs-painel)
    teste: d => /^#\d+\s+.+\bsaiu\b.*\bservidor\b/i.test(d),
    extrair: d => {
      const m = d.match(/^#(\d+)\s+(.+?)\s+saiu\b/i);
      return { atorIdFivem: m?.[1] ?? null, atorNome: m?.[2]?.trim() ?? null, categoria: 'conexao' };
    },
  },
  {
    acao: 'jogador_recrutou',
    // "#15277 Tiago Magrão recrutou #19465 Gelado Silva." (canal do sistema
    // de recrutamento do próprio jogo — nada a ver com o /recrutamento do
    // Discord). Cada recrutamento novo soma 1 em SÓCIOS SETADOS (CONFERIDO À
    // MÃO) no painel de jogadores — ver events/messageCreate.js.
    teste: d => /^#\d+\s+.+\brecrutou\b\s+#\d+/i.test(d),
    extrair: d => {
      const m = d.match(/^#(\d+)\s+(.+?)\s+recrutou\s+#(\d+)\s+(.+?)\.?\s*$/i);
      return {
        atorIdFivem: m?.[1] ?? null,
        atorNome: m?.[2]?.trim() ?? null,
        alvoIdFivem: m?.[3] ?? null,
        alvoNome: m?.[4]?.trim() ?? null,
        categoria: 'recrutamento',
      };
    },
  },
  {
    acao: 'sede_trancou',
    // "#163 Gladiador LHP trancou a sede." (canal logs-painel)
    teste: d => /^#\d+\s+.+\btrancou\s+a sede\b/i.test(d),
    extrair: d => extrairAtorNumerado(d, /trancou\s+a sede/i, { categoria: 'patrimonio' }),
  },
  {
    acao: 'sede_destrancou',
    // "#13067 Cris Sabará destrancou a sede."
    teste: d => /^#\d+\s+.+\bdestrancou\s+a sede\b/i.test(d),
    extrair: d => extrairAtorNumerado(d, /destrancou\s+a sede/i, { categoria: 'patrimonio' }),
  },
  {
    acao: 'portao_trancou',
    // "#1983 Joao Vitor trancou o portão do galpão." / "... o portão externo."
    teste: d => /^#\d+\s+.+\btrancou\s+o portão\b/i.test(d),
    extrair: d => extrairAtorNumerado(d, /trancou\s+o portão/i, { categoria: 'patrimonio' }),
  },
  {
    acao: 'portao_destrancou',
    // "#7311 Bragunso Pertubado destrancou o portão externo."
    teste: d => /^#\d+\s+.+\bdestrancou\s+o portão\b/i.test(d),
    extrair: d => extrairAtorNumerado(d, /destrancou\s+o portão/i, { categoria: 'patrimonio' }),
  },
  {
    acao: 'usou_sistema_porta',
    // "O jogador Mgzin Lhp (ID: 377) usou o sistema de trancar porta." — não
    // diz se foi pra trancar ou destrancar, só que alguém usou o sistema.
    // Conta como atividade de liderança mesmo sem saber o estado resultante.
    teste: d => /usou o sistema de trancar porta/i.test(d),
    extrair: d => ({
      atorNome: d.match(/O jogador\s+(.+?)\s*\(\s*ID:/i)?.[1]?.trim() ?? null,
      atorIdFivem: d.match(/\(\s*ID:\s*(\d+)\s*\)/i)?.[1] ?? null,
      categoria: 'patrimonio',
    }),
  },
  {
    acao: 'convocou_equipe',
    // "O jogador Japa Sccp (ID: 368) convocou a equipe para a sede."
    teste: d => /convocou a equipe/i.test(d),
    extrair: d => ({
      atorNome: d.match(/O jogador\s+(.+?)\s*\(\s*ID:/i)?.[1]?.trim() ?? null,
      atorIdFivem: d.match(/\(\s*ID:\s*(\d+)\s*\)/i)?.[1] ?? null,
      categoria: 'lideranca',
    }),
  },
  {
    acao: 'promoveu_cargo',
    // "#560 Gabriel Inajar promoveu #7670 Milgrau LHP (Sócio > Recrutador)."
    // O "(X > Y)" fica intacto na descrição — quem for montar o histórico de
    // carreira relê a partir dela, não precisa de coluna nova no banco.
    teste: d => /^#\d+\s+.+\bpromoveu\s+#\d+/i.test(d),
    extrair: d => extrairAtorAlvo(d, /promoveu/i, { categoria: 'hierarquia' }),
  },
  {
    acao: 'rebaixou_cargo',
    // "#1535 Texugo daBaixada rebaixou #196 Miguel ZonaLeste (Diretor > Recrutador)."
    teste: d => /^#\d+\s+.+\brebaixou\s+#\d+/i.test(d),
    extrair: d => extrairAtorAlvo(d, /rebaixou/i, { categoria: 'hierarquia' }),
  },
  {
    acao: 'expulso_torcida',
    // "#2190 Macaco Loko removeu #3766 Paulo Vitor ()." — parênteses vazios
    // no fim é o que diferencia de "removeu blacklist/suspensão da torcida"
    // (teste abaixo), que não tem um segundo #ID de alvo.
    teste: d => /^#\d+\s+.+\bremoveu\s+#\d+\s+.+\(\s*\)\.?\s*$/i.test(d),
    extrair: d => extrairAtorAlvo(d, /removeu/i, { categoria: 'saida' }),
  },
  {
    acao: 'removido_torcida_automatico',
    // "#10728 Jhow Sccp removido automaticamente da torcida (sem login há
    // mais de 10 dias)." — o próprio sistema do jogo removeu por inatividade,
    // não tem "ator" que agiu, só o alvo removido.
    teste: d => /removido automaticamente da torcida/i.test(d),
    extrair: d => {
      const m = d.match(/^#(\d+)\s+(.+?)\s+removido automaticamente/i);
      return { alvoIdFivem: m?.[1] ?? null, alvoNome: m?.[2]?.trim() ?? null, categoria: 'saida' };
    },
  },
  {
    acao: 'saiu_torcida',
    // "#906 pepe dobronx saiu da torcida." — saída voluntária.
    teste: d => /^#\d+\s+.+\bsaiu da torcida\b/i.test(d),
    extrair: d => extrairAtorNumerado(d, /saiu da torcida/i, { categoria: 'saida' }),
  },
];

// "#<ID> Nome <verbo...>" — o padrão mais comum do canal logs-painel: um
// ator numerado seguido do verbo que casou no teste() da regra.
function extrairAtorNumerado(d, verboRegex, extra = {}) {
  const m = d.match(new RegExp(`^#(\\d+)\\s+(.+?)\\s+${verboRegex.source}`, 'i'));
  return { atorIdFivem: m?.[1] ?? null, atorNome: m?.[2]?.trim() ?? null, ...extra };
}

// "#<ID> Nome <verbo> #<ID> Alvo (...)." — ator numerado agindo sobre um
// alvo também numerado (promoção, rebaixamento, expulsão).
function extrairAtorAlvo(d, verboRegex, extra = {}) {
  const m = d.match(new RegExp(`^#(\\d+)\\s+(.+?)\\s+${verboRegex.source}\\s+#(\\d+)\\s+(.+?)\\s*(?:\\(|\\.|$)`, 'i'));
  return {
    atorIdFivem: m?.[1] ?? null,
    atorNome: m?.[2]?.trim() ?? null,
    alvoIdFivem: m?.[3] ?? null,
    alvoNome: m?.[4]?.trim() ?? null,
    ...extra,
  };
}

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
