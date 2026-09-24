// Cria a pasta de uma torcida nova em modo instalação:
//   npm run novo-tenant -- --slug mancha-verde --guild 123456789012345678 --nome "Mancha Verde" [--fonte hoolibras] [--dir /caminho/dos/tenants]
// Gera <dir>/<slug>/{tenant.js, tema.js, assets/} e diz os próximos passos. Sem --dir
// usa TENANTS_DIR, ou tenants/ do repositório. Para vender: mantenha os tenants dos
// clientes fora do repositório (TENANTS_DIR).
const fs = require('fs');
const path = require('path');
const { gerarTenantEsqueleto } = require('../utils/setup/esqueleto');

function lerArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i];
  }
  return args;
}

// Imagens de partida (círculo branco sobre fundo escuro) para o bot subir sem
// arquivo faltando; a torcida troca pelos arquivos dela.
function gerarAssetsDeExemplo(pasta) {
  const { createCanvas } = require('canvas');
  for (const [nome, w, h] of [['logo.png', 256, 256], ['capa.png', 600, 200], ['faixa.png', 600, 60]]) {
    const c = createCanvas(w, h);
    const g = c.getContext('2d');
    g.fillStyle = '#222222';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.arc(w / 2, h / 2, Math.min(w, h) / 4, 0, Math.PI * 2);
    g.fill();
    fs.writeFileSync(path.join(pasta, nome), c.toBuffer('image/png'));
  }
}

function criar({ slug, guild, nome, fonte = 'hoolibras' }, raiz = path.join(__dirname, '..', 'tenants')) {
  const arquivos = gerarTenantEsqueleto({ slug, guildId: guild, nome, fonte });
  const pasta = path.join(raiz, slug);
  if (fs.existsSync(pasta)) throw new Error(`tenants/${slug} já existe — nada foi alterado`);
  fs.mkdirSync(path.join(pasta, 'assets'), { recursive: true });
  for (const [arquivo, conteudo] of Object.entries(arquivos)) fs.writeFileSync(path.join(pasta, arquivo), conteudo);
  gerarAssetsDeExemplo(path.join(pasta, 'assets'));
  return pasta;
}

if (require.main === module) {
  try {
    const { dir, ...args } = lerArgs(process.argv.slice(2));
    const raiz = dir ?? process.env.TENANTS_DIR ?? undefined;
    const pasta = criar(args, raiz ? path.resolve(raiz) : undefined);
    console.log(`Tenant criado em ${path.relative(process.cwd(), pasta)}`);
    console.log('\nPróximos passos:');
    console.log('  1. Coloque no .env:  TENANT=<slug>  (e DISCORD_TOKEN, CLIENT_ID, DATABASE_URL do bot desta torcida;');
    console.log('     se criou fora do repositório, também TENANTS_DIR=<caminho absoluto>)');
    console.log('  2. npm run deploy   (registra o /setup)   →   npm start');
    console.log('  3. No Discord: /setup diagnostico, /setup mapear, /setup criar');
    console.log('  4. Cole os IDs no tenant.js da torcida e remova `instalacao: true`');
  } catch (err) {
    console.error(`Erro: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { criar, lerArgs };
