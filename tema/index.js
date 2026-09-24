// Tema ativo do bot: cores, emojis, marca e assets da torcida. Nenhum módulo
// escreve cor/emoji de estado/marca literal — pede aqui. Contrato e exemplos:
// docs/contratos/tema.md
//
//   const tema = require('../tema');
//   new EmbedBuilder().setColor(tema.cor.perigo).setTitle(tema.titulo('BAÚ DA TORCIDA'))
//   files: [tema.logo()]   thumbnail: tema.urlLogo()
const path = require('path');
const { slug, pasta } = require('../tenants/ativo');
const { criarTema } = require('./criar');

function carregarDoTenant() {
  let especifico;
  try {
    especifico = require(path.join(pasta, 'tema.js'));
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND' && String(err.message).includes('tema.js')) throw new Error(`Tenant "${slug}" sem tema: esperado tenants/${slug}/tema.js`, { cause: err });
    throw err;
  }
  return criarTema(especifico, { pastaAssets: path.join(pasta, 'assets') });
}

module.exports = carregarDoTenant();
