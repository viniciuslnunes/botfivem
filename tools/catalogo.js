// Catálogo do produto em JSON (módulos + torcidas), para a loja/vitrine:
//   npm run catalogo                      → tenants/ do repositório
//   TENANTS_DIR=/caminho npm run catalogo → tenants fora do repositório
// Não conecta no Discord nem no banco.
process.env.DATABASE_URL = 'postgres://teste:teste@127.0.0.1:1/teste';
const path = require('path');
const manifestos = require('../modulos');
const { catalogoDeModulos, catalogoDeTorcidas } = require('../plataforma/catalogo');

if (require.main === module) {
  const raiz = process.env.TENANTS_DIR ? path.resolve(process.env.TENANTS_DIR) : path.join(__dirname, '..', 'tenants');
  console.log(JSON.stringify({ modulos: catalogoDeModulos(manifestos), torcidas: catalogoDeTorcidas(raiz, manifestos) }, null, 2));
  process.exit(0);
}
