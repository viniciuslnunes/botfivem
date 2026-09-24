// Gera o trecho de tenant.js com o que o /setup descobriu ou criou, pronto para
// a pessoa colar (ou para ler e conferir). Puro.

function literal(valor) {
  if (Array.isArray(valor)) return `[${valor.map(v => `'${v}'`).join(', ')}]`;
  if (valor === null || valor === undefined) return 'null';
  return `'${valor}'`;
}

function bloco(nome, objeto) {
  const linhas = Object.entries(objeto).map(([k, v]) => `    ${k}: ${literal(v)},`);
  return `  ${nome}: {\n${linhas.join('\n')}\n  },`;
}

// mapeamento: { cargos, canais, categorias } (id ou lista de ids por chave)
function gerarSnippet(mapeamento) {
  const partes = [];
  for (const nome of ['cargos', 'canais', 'categorias']) {
    if (mapeamento[nome] && Object.keys(mapeamento[nome]).length) partes.push(bloco(nome, mapeamento[nome]));
  }
  return partes.length
    ? `// Cole/mescle em tenants/<slug>/tenant.js (cada chave dentro do bloco de mesmo nome)\n${partes.join('\n')}\n`
    : '// Nada a acrescentar.\n';
}

module.exports = { gerarSnippet };
