// Roda a suíte inteira em várias versões do Node, sem instalar nada na máquina:
// baixa o binário oficial de nodejs.org (guardado em cache) e executa `node --test`.
//
//   npm run testar:node -- 22 24        # linhas de versão (pega a mais recente de cada)
//   npm run testar:node -- 22.23.3 26   # versão exata ou linha
//
// É o jeito de decidir "posso subir a versão do Node?" com prova: se a suíte
// passa nas versões alvo, o fluxo dos módulos, da plataforma e dos painéis
// continua igual. Sai com código 1 se qualquer versão falhar.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CACHE = path.join(os.tmpdir(), 'botfivem-node-versoes');
const RAIZ = path.join(__dirname, '..');

function plataforma() {
  const arq = { x64: 'x64', arm64: 'arm64' }[process.arch];
  if (!arq) throw new Error(`arquitetura sem suporte: ${process.arch}`);
  if (process.platform === 'win32') return { sufixo: `win-${arq}`, ext: 'zip', exe: 'node.exe', subdir: '' };
  if (process.platform === 'darwin') return { sufixo: `darwin-${arq}`, ext: 'tar.gz', exe: 'node', subdir: 'bin' };
  if (process.platform === 'linux') return { sufixo: `linux-${arq}`, ext: 'tar.xz', exe: 'node', subdir: 'bin' };
  throw new Error(`sistema sem suporte: ${process.platform}`);
}

async function resolverVersao(pedida, indice) {
  const alvo = String(pedida).replace(/^v/, '');
  const achada = indice.find(v => v.version === `v${alvo}` || v.version.startsWith(`v${alvo}.`));
  if (!achada) throw new Error(`Node "${pedida}" não existe em nodejs.org/dist`);
  return achada.version;
}

async function garantirBinario(versao, plat) {
  const nome = `node-${versao}-${plat.sufixo}`;
  const pasta = path.join(CACHE, nome);
  const exe = path.join(pasta, plat.subdir, plat.exe);
  if (fs.existsSync(exe)) return exe;

  fs.mkdirSync(CACHE, { recursive: true });
  const url = `https://nodejs.org/dist/${versao}/${nome}.${plat.ext}`;
  const arquivo = path.join(CACHE, `${nome}.${plat.ext}`);
  console.log(`  baixando ${url}`);
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error(`download falhou (${resposta.status}): ${url}`);
  fs.writeFileSync(arquivo, Buffer.from(await resposta.arrayBuffer()));
  // `tar` existe no Windows 10+, macOS e Linux e extrai os três formatos. No Windows
  // usa o bsdtar do sistema (o `tar` do Git Bash é GNU e não lê zip nem caminho com "C:").
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const r = spawnSync(tar, ['-xf', arquivo, '-C', CACHE], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`não consegui extrair ${arquivo}: ${r.stderr}`);
  fs.rmSync(arquivo, { force: true });
  if (!fs.existsSync(exe)) throw new Error(`binário não encontrado depois de extrair: ${exe}`);
  return exe;
}

async function main(pedidas) {
  if (!pedidas.length) {
    console.error('Uso: npm run testar:node -- <versão> [<versão> ...]   (ex.: 22 24)');
    process.exit(2);
  }
  const plat = plataforma();
  const indice = await (await fetch('https://nodejs.org/dist/index.json')).json();
  const resultados = [];

  for (const pedida of pedidas) {
    const versao = await resolverVersao(pedida, indice);
    console.log(`\n=== Node ${versao}`);
    const exe = await garantirBinario(versao, plat);
    // Banco falso e nunca o .env real: a suíte já se protege, mas o ambiente fica explícito.
    const env = { ...process.env, DATABASE_URL: 'postgres://teste:teste@127.0.0.1:1/teste', DATABASE_SSL: 'off' };
    const r = spawnSync(exe, ['--test'], { cwd: RAIZ, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
    const saida = `${r.stdout}\n${r.stderr}`;
    const pega = re => Number((re.exec(saida) ?? [])[1] ?? NaN);
    const totais = {
      testes: pega(/^(?:ℹ|#) tests (\d+)/m),
      passaram: pega(/^(?:ℹ|#) pass (\d+)/m),
      falharam: pega(/^(?:ℹ|#) fail (\d+)/m),
      canceladas: pega(/^(?:ℹ|#) cancelled (\d+)/m),
    };
    const ok = r.status === 0 && totais.falharam === 0 && totais.canceladas === 0;
    console.log(`  ${totais.passaram}/${totais.testes} passaram · ${totais.falharam} falharam · ${totais.canceladas} canceladas → ${ok ? 'OK' : 'FALHOU'}`);
    if (!ok) console.log(saida.split('\n').filter(l => /^(not ok|✖)/.test(l)).slice(0, 15).join('\n'));
    resultados.push({ versao, ok });
  }

  console.log('\nResumo:', resultados.map(r => `${r.versao} ${r.ok ? 'OK' : 'FALHOU'}`).join(' · '));
  process.exit(resultados.every(r => r.ok) ? 0 : 1);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(err => { console.error(`Erro: ${err.message}`); process.exit(1); });
}

module.exports = { plataforma, resolverVersao };
