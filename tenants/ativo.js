// Qual tenant (torcida) esta instância do bot atende. Uma instância = um
// tenant = um token de bot + um Postgres (ver docs/plano-produto-multi-torcida.md
// § 3.1). Escolhido pela variável TENANT (default: gavioes).
//
// TENANTS_DIR (opcional, caminho absoluto): procura os tenants FORA do
// repositório. É o que permite vender o produto sem misturar os dados de uma
// torcida (IDs, marca, assets) com os de outra nem com o código.
const fs = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });

const slug = process.env.TENANT || 'gavioes';
// Slug vira nome de pasta: nada de "../" nem separador.
if (!/^[A-Za-z0-9_-]+$/.test(slug)) {
  throw new Error(`TENANT inválido: "${slug}" (use só letras, números, "-" e "_")`);
}

const raiz = process.env.TENANTS_DIR ? path.resolve(process.env.TENANTS_DIR) : __dirname;
if (process.env.TENANTS_DIR && !fs.existsSync(raiz)) {
  throw new Error(`TENANTS_DIR não existe: ${raiz}`);
}

module.exports = { slug, raiz, pasta: path.join(raiz, slug) };
