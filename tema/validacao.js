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

function ehCorInteira(v) {
  return Number.isInteger(v) && v >= 0 && v <= 0xFFFFFF;
}

function ehCorHex(v) {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
}

const BLOCOS_HEX = ['imagem', 'cartao', 'transcricao'];
const EMOJIS_OBRIGATORIOS = ['ok', 'ativo', 'inativo', 'perigo', 'aviso', 'pendente', 'recusado', 'marca'];
const MARCA_OBRIGATORIA = [
  'nome', 'nomeSegmentado', 'nomeCurto', 'nomeNormal', 'nomeNormalFivem', 'nomeTorcida',
  'de', 'sigla', 'nickPrefixo', 'logo',
];

// Devolve a lista de problemas (vazia = tema válido).
function validarTema(tema) {
  const erros = [];
  const proibidos = tema.proibido?.matizes;
  if (!Array.isArray(proibidos)) erros.push('proibido.matizes deve ser uma lista');
  for (const m of proibidos || []) {
    if (!MATIZES[m]) erros.push(`proibido.matizes: matiz desconhecido "${m}" (use: ${Object.keys(MATIZES).join(', ')})`);
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
      if (matizDe(t.valor) === matiz) erros.push(`${t.caminho} (${formatar(t.valor)}) é ${matiz}, matiz proibido neste tema`);
    }
    const lista = EMOJIS_POR_MATIZ[matiz] || [];
    for (const [nome, v] of Object.entries(tema.emoji || {})) {
      if (typeof v === 'string' && lista.some(e => v.includes(e))) erros.push(`emoji.${nome} (${v}) é ${matiz}, matiz proibido neste tema`);
    }
  }
  return erros;
}

function formatar(v) {
  return typeof v === 'number' ? `0x${v.toString(16).padStart(6, '0').toUpperCase()}` : v;
}

module.exports = { validarTema, matizDe, MATIZES, EMOJIS_POR_MATIZ };
