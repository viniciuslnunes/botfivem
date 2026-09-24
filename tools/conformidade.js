// Guardião de conformidade: transforma as regras de docs/padroes.md em
// contagem verificável. Usado por test/conformidade.test.js e como CLI:
//   node tools/conformidade.js            → relatório
//   node tools/conformidade.js --json     → contagem por regra/arquivo
//
// Uma regra por vez, contagem por arquivo. O teste compara com
// test/conformidade.baseline.json e só deixa o número cair.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

// Onde o código de módulo é varrido. Fora daqui (config/, tenants/, tema/,
// test/, tools/) é onde cor, marca e ID PODEM morar.
const PASTAS = ['utils', 'commands', 'modulos', 'plataforma'];
const ARQUIVOS_RAIZ = ['index.js', 'deploy-commands.js'];

// Cada regra recebe o texto SEM comentários de linha inteira nem blocos /* */
// (comentário explicativo pode citar a marca ou uma cor sem ser violação).
const REGRAS = {
  cor: {
    descricao: 'Literal de cor (0xRRGGBB, #RRGGBB, rgb()/rgba(), #rgb em CSS) fora do tema',
    // #rgb só conta em contexto de CSS ("color: #fff"): "#123" solto é ID de jogador/reserva.
    regex: /0x[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{6}\b|\brgba?\(|(?:color|background|border[\w-]*|fill|stroke)\s*:\s*#[0-9A-Fa-f]{3}\b/g,
  },
  emojiEstado: {
    descricao: 'Emoji de estado verde (🟢 ✅ 💚 🟩) fora do tema',
    regex: /🟢|✅|💚|🟩/gu,
  },
  marca: {
    descricao: 'Marca de torcida/servidor de jogo cravada no código',
    regex: /gavi[õo]es|\bGDF\b|R\.S\.J|\bRSJ\b|hoolibras|narnia|corinthians|\bfiel\b|linktr\.ee|discord\.gg/gi,
  },
  idDiscord: {
    descricao: 'ID de Discord (17–20 dígitos) literal fora de config/tenants',
    regex: /['"`]\d{17,20}['"`]/g,
  },
  caminhoAsset: {
    descricao: 'Caminho literal de img/ ou fonts/ (assets pertencem ao tenant)',
    regex: /(?:^|[^\w])(?:img|fonts)\//g,
  },
};

function semComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
    .split('\n')
    .map(l => (/^\s*\/\//.test(l) ? '' : l))
    .join('\n');
}

function listarJs(dir) {
  const abs = path.join(RAIZ, dir);
  if (!fs.existsSync(abs)) return [];
  const saida = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) saida.push(...listarJs(rel));
    else if (e.name.endsWith('.js')) saida.push(rel);
  }
  return saida;
}

function arquivosVarridos() {
  return [...PASTAS.flatMap(listarJs), ...ARQUIVOS_RAIZ.filter(f => fs.existsSync(path.join(RAIZ, f)))].sort();
}

// { regra: { 'utils/x.js': n } } — só arquivos com n > 0.
function contar() {
  const resultado = Object.fromEntries(Object.keys(REGRAS).map(k => [k, {}]));
  for (const arquivo of arquivosVarridos()) {
    const texto = semComentarios(fs.readFileSync(path.join(RAIZ, arquivo), 'utf8'));
    for (const [nome, regra] of Object.entries(REGRAS)) {
      const n = (texto.match(regra.regex) || []).length;
      if (n > 0) resultado[nome][arquivo] = n;
    }
  }
  return resultado;
}

// Compara contagem atual com o baseline. Devolve { pioraram, melhoraram }.
function comparar(atual, baseline) {
  const pioraram = [];
  const melhoraram = [];
  for (const regra of Object.keys(REGRAS)) {
    const a = atual[regra] || {};
    const b = baseline[regra] || {};
    for (const arq of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const na = a[arq] || 0;
      const nb = b[arq] || 0;
      if (na > nb) pioraram.push({ regra, arquivo: arq, de: nb, para: na });
      else if (na < nb) melhoraram.push({ regra, arquivo: arq, de: nb, para: na });
    }
  }
  return { pioraram, melhoraram };
}

function totais(contagem) {
  return Object.fromEntries(Object.entries(contagem).map(([r, porArq]) => [
    r, { arquivos: Object.keys(porArq).length, ocorrencias: Object.values(porArq).reduce((s, n) => s + n, 0) },
  ]));
}

if (require.main === module) {
  const c = contar();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(c, null, 2));
  } else {
    for (const [regra, t] of Object.entries(totais(c))) {
      console.log(`${regra.padEnd(14)} ${String(t.ocorrencias).padStart(4)} ocorrência(s) em ${t.arquivos} arquivo(s) — ${REGRAS[regra].descricao}`);
    }
  }
}

module.exports = { REGRAS, contar, comparar, totais, semComentarios, arquivosVarridos };
