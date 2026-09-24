// Carrega a fonte de logs do tenant (tenant.jogo.fonte). Falha na subida se a
// fonte não existir ou não cumprir o contrato (fontes/contrato.js).
const fs = require('fs');
const path = require('path');
const { validarFonte } = require('./contrato');

const RAIZ_FONTES = __dirname;

// `raiz` existe só para teste (fonte falsa numa pasta temporária).
function carregarFonte(id, { raiz = RAIZ_FONTES } = {}) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`jogo.fonte inválida: ${JSON.stringify(id)} (use só letras, números, "-" e "_")`);
  }
  const arquivo = path.join(raiz, id, 'index.js');
  if (!fs.existsSync(arquivo)) {
    const disponiveis = fs.readdirSync(raiz, { withFileTypes: true })
      .filter(e => e.isDirectory() && fs.existsSync(path.join(raiz, e.name, 'index.js')))
      .map(e => e.name);
    throw new Error(`Fonte de logs "${id}" não encontrada: esperado fontes/${id}/index.js (disponíveis: ${disponiveis.join(', ') || 'nenhuma'})`);
  }
  const fonte = require(arquivo);
  const erros = validarFonte(fonte, id);
  if (erros.length) throw new Error(`Fonte de logs "${id}" inválida:\n - ${erros.join('\n - ')}`);
  return fonte;
}

module.exports = { carregarFonte };
