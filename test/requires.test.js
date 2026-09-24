// Todo require relativo do código precisa apontar para um arquivo que existe.
// O ESLint não pega isso, e um require preguiçoso (dentro de função) só quebra
// quando o fluxo roda — foi assim que um `require('../utils/db')` copiado do
// antigo events/ para utils/recrutamento/ ia derrubar a aprovação de recrutamento
// em produção sem nenhum teste avisar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
// test/ fica de fora: os scripts em texto que os testes rodam em subprocesso têm caminhos relativos à raiz.
const PASTAS = ['utils', 'commands', 'modulos', 'plataforma', 'config', 'tema', 'tenants', 'fontes', 'tools', 'integracao'];
const RAIZ_ARQUIVOS = ['index.js', 'deploy-commands.js', 'eslint.config.js'];

function listar(dir) {
  const abs = path.join(RAIZ, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap(e => {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : listar(rel);
    return e.name.endsWith('.js') ? [rel] : [];
  });
}

function resolve(deArquivo, alvo) {
  const base = path.resolve(RAIZ, path.dirname(deArquivo), alvo);
  const candidatos = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')];
  return candidatos.some(c => fs.existsSync(c) && (fs.statSync(c).isFile() || fs.existsSync(path.join(c, 'index.js'))));
}

test('todo require("./...") ou require("../...") aponta para um arquivo que existe', () => {
  const arquivos = [...PASTAS.flatMap(listar), ...RAIZ_ARQUIVOS.filter(f => fs.existsSync(path.join(RAIZ, f)))];
  const quebrados = [];
  for (const arq of arquivos) {
    const src = fs.readFileSync(path.join(RAIZ, arq), 'utf8');
    // ignora comentários de linha inteira
    const codigo = src.split('\n').map(l => (/^\s*\/\//.test(l) ? '' : l)).join('\n');
    for (const m of codigo.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
      if (!resolve(arq, m[1])) quebrados.push(`${arq}: require('${m[1]}')`);
    }
  }
  assert.deepEqual(quebrados, [], `requires que não resolvem:\n${quebrados.join('\n')}`);
});

test('o detector funciona: pega um require quebrado e aceita um válido (com e sem extensão, e pasta com index)', () => {
  assert.equal(resolve('utils/recrutamento/interacoes.js', '../utils/db'), false); // o bug real
  assert.equal(resolve('utils/recrutamento/interacoes.js', '../db'), true);
  assert.equal(resolve('utils/recrutamento/interacoes.js', '../../config/index.js'), true);
  assert.equal(resolve('utils/recrutamento/interacoes.js', '../../tema'), true); // pasta com index.js
  assert.equal(resolve('index.js', './plataforma'), true);
});
