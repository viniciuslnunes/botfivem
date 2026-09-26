// Catálogo do produto para a loja: o que cada módulo faz e como cada torcida
// está configurada. Puro (recebe manifestos e pastas), sem Discord nem banco,
// e SEM dado sensível: nada de ID de Discord, token ou caminho de asset.
// Gerado por `npm run catalogo`; a loja lê o JSON, nunca copia texto à mão.
const fs = require('fs');
const path = require('path');
const { criarTema } = require('../tema/criar');

function catalogoDeModulos(manifestos) {
  return manifestos.map(m => ({
    id: m.id,
    descricao: m.descricao,
    padrao: Boolean(m.padrao),
    obrigatorio: Boolean(m.obrigatorio),
    requer: m.requer || [],
    comandos: m.comandos || [],
  }));
}

function corHex(n) {
  return `#${n.toString(16).padStart(6, '0').toUpperCase()}`;
}

// Módulos ligados de um tenant, pela regra da plataforma: entrada explícita
// no tenant, senão o `padrao` do manifesto.
function modulosLigados(manifestos, tenant) {
  return manifestos
    .filter(m => m.obrigatorio || (tenant.modulos && m.id in tenant.modulos ? tenant.modulos[m.id] : m.padrao))
    .map(m => m.id);
}

function cartaoDaTorcida({ slug, tenant, especificoTema, manifestos }) {
  const tema = criarTema(especificoTema, { pastaAssets: '' });
  return {
    slug,
    nome: tema.marca.nomeNormal,
    sigla: tema.marca.sigla,
    instalacao: Boolean(tenant.instalacao),
    fonteDeLogs: tenant.jogo?.fonte ?? null,
    modulos: modulosLigados(manifestos, tenant),
    hierarquia: (tenant.hierarquia || []).map(h => h.label),
    paleta: {
      primaria: corHex(tema.cor.primaria),
      perigo: corHex(tema.cor.perigo),
      aviso: corHex(tema.cor.aviso),
      destaque: corHex(tema.cor.destaque),
    },
    proibido: { matizes: tema.proibido.matizes, tons: tema.proibido.tons ?? [] },
  };
}

// Lê todas as pastas de tenants (as que começam com "_" são molde/teste).
// Uma torcida quebrada não derruba o catálogo: aparece com `erro`.
function catalogoDeTorcidas(raiz, manifestos) {
  const saida = [];
  for (const e of fs.readdirSync(raiz, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('_')) continue;
    try {
      const tenant = require(path.join(raiz, e.name, 'tenant.js'));
      const especificoTema = require(path.join(raiz, e.name, 'tema.js'));
      saida.push(cartaoDaTorcida({ slug: e.name, tenant, especificoTema, manifestos }));
    } catch (err) {
      saida.push({ slug: e.name, erro: err.message.split('\n').slice(0, 3).join(' | ') });
    }
  }
  return saida;
}

module.exports = { catalogoDeModulos, catalogoDeTorcidas, cartaoDaTorcida, modulosLigados };
