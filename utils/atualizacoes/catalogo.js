const fs = require('fs');
const path = require('path');
const { validarEntrada } = require('./regras');

// Catálogo: um arquivo por atualização em `atualizacoes/AAAA-MM-DD-slug.js`
// (arquivos que começam com "_" são ignorados). O nome do arquivo é o id da entrada.
const PASTA = path.join(__dirname, '..', '..', 'atualizacoes');

// Entrada inválida derruba o teste; em produção só é pulada (uma entrada ruim não
// pode impedir as outras de saírem nem o bot de subir).
function carregar({ pasta = PASTA, modulosConhecidos = null, log = console.error } = {}) {
  if (!fs.existsSync(pasta)) return [];
  const entradas = [];
  for (const arquivo of fs.readdirSync(pasta).filter(f => f.endsWith('.js') && !f.startsWith('_')).sort()) {
    const entrada = require(path.join(pasta, arquivo));
    const erros = validarEntrada(entrada, { modulosConhecidos, origem: arquivo });
    if (entrada?.id !== arquivo.replace(/\.js$/, '')) erros.push(`${arquivo}: id deve ser igual ao nome do arquivo`);
    if (erros.length) {
      log('[atualizacoes] Entrada ignorada:', erros.join(' | '));
      continue;
    }
    entradas.push(entrada);
  }
  return entradas;
}

module.exports = { carregar, PASTA };
