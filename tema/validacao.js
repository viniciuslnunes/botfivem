// Validação do tema: formato dos tokens e matiz proibido. Puro (sem Discord,
// sem banco) para poder ser testado e rodado na subida do bot.

// Faixas de matiz em graus (HSL). Cor "sem matiz" (cinza, preto, branco) não
// entra em nenhuma: exige saturação e luminosidade mínimas para contar.
const MATIZES = {
  vermelho: [[345, 360], [0, 15]],
  laranja: [[15, 45]],
  amarelo: [[45, 75]],
  verde: [[75, 165]],
  ciano: [[165, 200]],
  azul: [[200, 260]],
  roxo: [[260, 300]],
  rosa: [[300, 345]],
};

// Emojis que "leem" como cada matiz. Usado para o `proibido` também valer nos
// emojis de estado (🟢 ✅ são verdes mesmo sem hex nenhum).
const EMOJIS_POR_MATIZ = {
  verde: ['🟢', '✅', '💚', '🟩', '🍀', '🥬', '🟢'],
  vermelho: ['🔴', '❤️', '🟥', '❌', '♥️'],
  azul: ['🔵', '💙', '🟦'],
  amarelo: ['🟡', '💛', '🟨'],
  roxo: ['🟣', '💜', '🟪'],
  laranja: ['🟠', '🧡', '🟧'],
};

// Tons sem matiz que uma torcida também pode recusar (mancha que não usa preto,
// por exemplo). "preto" é escuro e pouco saturado; "branco", muito claro;
// "cinza" é o resto sem saturação.
const TONS = ['preto', 'branco', 'cinza'];
const EMOJIS_POR_TOM = {
  preto: ['⚫', '⬛', '🖤', '🏴'],
  branco: ['⚪', '⬜', '🤍', '🏳'],
  cinza: [],
};
const PRETO_LUMINOSIDADE_MAX = 0.13;
const PRETO_SATURACAO_MAX = 0.35;

const SATURACAO_MINIMA = 0.2;
const LUMINOSIDADE_MIN = 0.08;
const LUMINOSIDADE_MAX = 0.92;

function paraRgb(cor) {
  if (typeof cor === 'number') return [(cor >> 16) & 255, (cor >> 8) & 255, cor & 255];
  const m = /^#([0-9a-f]{6})$/i.exec(cor);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function paraHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

// Nome do matiz da cor, ou null se ela é acromática (cinza/preto/branco).
function matizDe(cor) {
  const rgb = paraRgb(cor);
  if (!rgb) return null;
  const { h, s, l } = paraHsl(rgb);
  if (s < SATURACAO_MINIMA || l < LUMINOSIDADE_MIN || l > LUMINOSIDADE_MAX) return null;
  for (const [nome, faixas] of Object.entries(MATIZES)) {
    if (faixas.some(([a, b]) => h >= a && h < b)) return nome;
  }
  return null;
}

// Tom sem matiz da cor ('preto' | 'branco' | 'cinza'), ou null se tem matiz.
function tomDe(cor) {
  const rgb = paraRgb(cor);
  if (!rgb) return null;
  const { s, l } = paraHsl(rgb);
  if (l <= PRETO_LUMINOSIDADE_MAX && s < PRETO_SATURACAO_MAX) return 'preto';
  if (l >= LUMINOSIDADE_MAX) return 'branco';
  if (s < SATURACAO_MINIMA) return 'cinza';
  return null;
}

// Contraste WCAG entre duas cores (1 a 21).
function contraste(a, b) {
  const lum = cor => {
    const [r, g, bl] = paraRgb(cor).map(v => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

// Pares texto/fundo que precisam ser legíveis em qualquer paleta.
const PARES_CONTRASTE = [
  ['imagem.texto', 'imagem.fundo', 4.5],
  ['imagem.textoFraco', 'imagem.fundo', 3],
  ['cartao.tinta', 'cartao.fundo', 4.5],
  ['cartao.sobreTinta', 'cartao.tinta', 4.5],
  ['transcricao.texto', 'transcricao.fundoPagina', 4.5],
  ['transcricao.textoFraco', 'transcricao.fundoPagina', 3],
];

function ehCorInteira(v) {
  return Number.isInteger(v) && v >= 0 && v <= 0xFFFFFF;
}

function ehCorHex(v) {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
}

const BLOCOS_HEX = ['imagem', 'cartao', 'transcricao'];
const EMOJIS_OBRIGATORIOS = ['ok', 'ativo', 'inativo', 'perigo', 'aviso', 'alerta', 'pendente', 'recusado', 'marca'];
const MARCA_OBRIGATORIA = [
  'nome', 'nomeSegmentado', 'nomeCurto', 'nomeNormal', 'nomeNormalFivem', 'nomeTorcida',
  'de', 'sigla', 'nickPrefixo', 'logo',
];

// Devolve a lista de problemas (vazia = tema válido).
// `herdados`: caminhos de token que o tenant NÃO declarou (vieram da base);
// só serve para a mensagem de erro dizer onde corrigir.
function validarTema(tema, { herdados = new Set() } = {}) {
  const erros = [];
  const origem = caminho => (herdados.has(caminho) ? ' — herdado da base, declare em tenants/<slug>/tema.js' : '');
  const proibidos = tema.proibido?.matizes;
  if (!Array.isArray(proibidos)) erros.push('proibido.matizes deve ser uma lista');
  for (const m of proibidos || []) {
    if (!MATIZES[m]) erros.push(`proibido.matizes: matiz desconhecido "${m}" (use: ${Object.keys(MATIZES).join(', ')})`);
  }

  const tons = tema.proibido?.tons ?? [];
  if (!Array.isArray(tons)) erros.push('proibido.tons deve ser uma lista');
  for (const m of Array.isArray(tons) ? tons : []) {
    if (!TONS.includes(m)) erros.push(`proibido.tons: tom desconhecido "${m}" (use: ${TONS.join(', ')})`);
  }

  const tokens = []; // { caminho, valor }
  for (const [nome, v] of Object.entries(tema.cor || {})) {
    if (!ehCorInteira(v)) erros.push(`cor.${nome}: esperado inteiro 0x000000–0xFFFFFF, veio ${JSON.stringify(v)}`);
    else tokens.push({ caminho: `cor.${nome}`, valor: v });
  }
  for (const bloco of BLOCOS_HEX) {
    for (const [nome, v] of Object.entries(tema[bloco] || {})) {
      if (!ehCorHex(v)) erros.push(`${bloco}.${nome}: esperado "#rrggbb", veio ${JSON.stringify(v)}`);
      else tokens.push({ caminho: `${bloco}.${nome}`, valor: v });
    }
  }
  for (const k of ['primaria', 'perigo', 'aviso', 'destaque', 'neutro']) {
    if (!(k in (tema.cor || {}))) erros.push(`cor.${k} é obrigatório`);
  }

  for (const k of EMOJIS_OBRIGATORIOS) {
    if (typeof tema.emoji?.[k] !== 'string' || !tema.emoji[k]) erros.push(`emoji.${k} é obrigatório`);
  }
  for (const k of MARCA_OBRIGATORIA) {
    if (typeof tema.marca?.[k] !== 'string' || !tema.marca[k]) erros.push(`marca.${k} é obrigatório`);
  }

  // Matiz proibido: vale para toda cor e todo emoji de estado.
  for (const matiz of Array.isArray(proibidos) ? proibidos : []) {
    for (const t of tokens) {
      if (matizDe(t.valor) === matiz) erros.push(`${t.caminho} (${formatar(t.valor)}) é ${matiz}, matiz proibido neste tema${origem(t.caminho)}`);
    }
    const lista = EMOJIS_POR_MATIZ[matiz] || [];
    for (const [nome, v] of Object.entries(tema.emoji || {})) {
      if (typeof v === 'string' && lista.some(e => v.includes(e))) erros.push(`emoji.${nome} (${v}) é ${matiz}, matiz proibido neste tema${origem(`emoji.${nome}`)}`);
    }
  }

  // Tom proibido (preto/branco/cinza): mesma regra, medida por luminosidade.
  for (const tom of Array.isArray(tons) ? tons.filter(x => TONS.includes(x)) : []) {
    for (const t of tokens) {
      if (tomDe(t.valor) === tom) erros.push(`${t.caminho} (${formatar(t.valor)}) é ${tom}, tom proibido neste tema${origem(t.caminho)}`);
    }
    const lista = EMOJIS_POR_TOM[tom] || [];
    for (const [nome, v] of Object.entries(tema.emoji || {})) {
      if (typeof v === 'string' && lista.some(e => v.includes(e))) erros.push(`emoji.${nome} (${v}) é ${tom}, tom proibido neste tema${origem(`emoji.${nome}`)}`);
    }
  }

  // Legibilidade: texto precisa contrastar com o fundo, seja qual for a paleta.
  for (const [texto, fundo, minimo] of PARES_CONTRASTE) {
    const [bt, nt] = texto.split('.');
    const [bf, nf] = fundo.split('.');
    const vt = tema[bt]?.[nt];
    const vf = tema[bf]?.[nf];
    if (!ehCorHex(vt) || !ehCorHex(vf)) continue;
    const c = contraste(vt, vf);
    if (c < minimo) erros.push(`contraste ${texto} (${vt}) sobre ${fundo} (${vf}) é ${c.toFixed(1)}:1, mínimo ${minimo}:1${origem(texto)}${origem(fundo)}`);
  }
  return erros;
}

function formatar(v) {
  return typeof v === 'number' ? `0x${v.toString(16).padStart(6, '0').toUpperCase()}` : v;
}

module.exports = { validarTema, matizDe, tomDe, contraste, MATIZES, TONS, EMOJIS_POR_MATIZ, EMOJIS_POR_TOM };
