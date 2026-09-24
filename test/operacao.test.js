// Operação: log estruturado, health e boot do index.js com configuração inválida.
// Nada toca Discord nem banco real.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { montarRegistro, formatarLinha, instalarLog } = require('../plataforma/log');
const { montarEstadoDeSaude, criarServidorDeSaude, porta } = require('../plataforma/saude');

const RAIZ = path.join(__dirname, '..');
const AGORA = new Date('2026-09-24T12:00:00.000Z');

// ── Log estruturado ──────────────────────────────────────────────────────────
test('log: "[modulo] mensagem" vira campo modulo; nível pelo método; tenant e horário sempre', () => {
  const r = montarRegistro({ metodo: 'error', args: ['[logs-jogo] Erro ao gravar log:', 'detalhe'], tenant: 'mancha', agora: AGORA });
  assert.deepEqual(r, { ts: '2026-09-24T12:00:00.000Z', nivel: 'error', tenant: 'mancha', modulo: 'logs-jogo', msg: 'Erro ao gravar log: detalhe' });
  assert.equal(montarRegistro({ metodo: 'warn', args: ['x'], tenant: 't', agora: AGORA }).nivel, 'warn');
  assert.equal(montarRegistro({ metodo: 'log', args: ['x'], tenant: 't', agora: AGORA }).nivel, 'info');
  assert.equal(montarRegistro({ metodo: 'log', args: ['sem módulo'], tenant: 't', agora: AGORA }).modulo, undefined);
});

test('log: Error vira objeto com nome, mensagem e stack; a mensagem cai no msg quando não há texto', () => {
  const err = Object.assign(new Error('banco caiu'), { code: 'ECONNRESET' });
  const r = montarRegistro({ metodo: 'error', args: ['[db] Erro:', err], tenant: 't', agora: AGORA });
  assert.equal(r.msg, 'Erro:');
  assert.equal(r.erro.mensagem, 'banco caiu');
  assert.equal(r.erro.code, 'ECONNRESET');
  assert.match(r.erro.stack, /banco caiu/);
  assert.equal(montarRegistro({ metodo: 'error', args: [err], tenant: 't', agora: AGORA }).msg, 'banco caiu');
});

test('log: objetos e números viram texto legível (sem quebrar em referência circular)', () => {
  const circular = { a: 1 };
  circular.eu = circular;
  const r = montarRegistro({ metodo: 'log', args: ['[x] dados', { a: 1, b: [2] }, 42, circular], tenant: 't', agora: AGORA });
  assert.match(r.msg, /dados \{ a: 1, b: \[ 2 \] \} 42 <ref \*1>/);
});

test('log: formatarLinha devolve UMA linha JSON válida (mesmo com quebra de linha na mensagem)', () => {
  const linha = formatarLinha({ metodo: 'log', args: ['[x] linha1\nlinha2'], tenant: 't', agora: AGORA });
  assert.equal(linha.includes('\n'), false);
  assert.equal(JSON.parse(linha).msg, 'linha1\nlinha2');
});

test('instalarLog: json troca os métodos e restaura; texto não mexe em nada; formato inválido é recusado', () => {
  const alvo = { log() {}, info() {}, debug() {}, warn() {}, error() {} };
  const originais = { ...alvo };
  assert.deepEqual(Object.keys(instalarLog({ formato: 'texto', alvo })), []);
  assert.equal(alvo.log, originais.log);

  const linhas = [];
  const restaurar = instalarLog({ formato: 'json', tenant: 'mancha', alvo, escrever: l => linhas.push(JSON.parse(l)) });
  alvo.log('[plataforma] subiu');
  alvo.error('[db] caiu', new Error('x'));
  assert.deepEqual(linhas.map(l => [l.nivel, l.modulo, l.tenant]), [['info', 'plataforma', 'mancha'], ['error', 'db', 'mancha']]);
  assert.ok(linhas[1].erro.stack);
  restaurar();
  assert.equal(alvo.log, originais.log);

  assert.throws(() => instalarLog({ formato: 'xml', alvo }), /LOG_FORMATO inválido: "xml" \(use: texto, json\)/);
});

// ── Health ───────────────────────────────────────────────────────────────────
const plataformaFalsa = { ativos: [{}, {}], desligados: [{}], modoInstalacao: false };
const tenant = { slug: 'mancha' };

test('saúde: ok só com banco respondendo E Discord pronto; senão degradado', async () => {
  const bancoOk = { query: async () => ({}) };
  const pronto = { isReady: () => true };
  const ok = await montarEstadoDeSaude({ client: pronto, plataforma: plataformaFalsa, tenant, banco: bancoOk });
  assert.equal(ok.status, 'ok');
  assert.equal(ok.tenant, 'mancha');
  assert.deepEqual(ok.modulos, { ligados: 2, desligados: 1 });
  assert.equal(ok.banco.ok, true);
  assert.ok(Number.isInteger(ok.uptimeSeg));

  const semDiscord = await montarEstadoDeSaude({ client: { isReady: () => false }, plataforma: plataformaFalsa, tenant, banco: bancoOk });
  assert.equal(semDiscord.status, 'degradado');
  assert.equal(semDiscord.discord.pronto, false);

  const semBanco = await montarEstadoDeSaude({ client: pronto, plataforma: plataformaFalsa, tenant, banco: { query: async () => { throw new Error('recusou'); } } });
  assert.equal(semBanco.status, 'degradado');
  assert.deepEqual(semBanco.banco, { ok: false, erro: 'recusou' });
});

test('saúde: banco pendurado não pendura o health (prazo)', async () => {
  const penduradoo = { query: () => new Promise(() => {}) };
  const t0 = Date.now();
  const estado = await montarEstadoDeSaude({ client: { isReady: () => true }, plataforma: plataformaFalsa, tenant, banco: penduradoo, prazoBancoMs: 50 });
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(estado.status, 'degradado');
  assert.match(estado.banco.erro, /sem resposta em 50 ms/);
});

test('saúde: porta inválida é recusada com mensagem clara', () => {
  assert.equal(porta('8080'), 8080);
  assert.equal(porta('0'), 0);
  for (const ruim of ['abc', '-1', '70000', '80.5']) assert.throws(() => porta(ruim), /HEALTH_PORT inválida/, ruim);
});

function pedir(portaReal, { metodo = 'GET', caminho = '/health' } = {}) {
  return new Promise((resolver, rejeitar) => {
    const req = http.request({ host: '127.0.0.1', port: portaReal, method: metodo, path: caminho }, res => {
      let corpo = '';
      res.on('data', d => { corpo += d; });
      res.on('end', () => resolver({ status: res.statusCode, tipo: res.headers['content-type'], corpo }));
    });
    req.on('error', rejeitar);
    req.end();
  });
}

test('servidor de saúde: 200 quando ok, 503 quando degradado, 404/405 fora do combinado, e só o JSON curto', async () => {
  let estado = { status: 'ok', tenant: 'mancha' };
  const saude = criarServidorDeSaude({ porta: 0, host: '127.0.0.1', obter: async () => estado });
  const p = await saude.iniciar();
  try {
    const ok = await pedir(p);
    assert.equal(ok.status, 200);
    assert.match(ok.tipo, /application\/json/);
    assert.deepEqual(JSON.parse(ok.corpo), { status: 'ok', tenant: 'mancha' });

    estado = { status: 'degradado', tenant: 'mancha' };
    assert.equal((await pedir(p)).status, 503);

    assert.equal((await pedir(p, { caminho: '/outra' })).status, 404);
    assert.equal((await pedir(p, { metodo: 'POST' })).status, 405);
  } finally {
    await saude.parar();
  }
});

test('servidor de saúde: exceção ao montar o estado vira 503, não derruba o servidor', async () => {
  const saude = criarServidorDeSaude({ porta: 0, host: '127.0.0.1', obter: async () => { throw new Error('estourou'); } });
  const p = await saude.iniciar();
  try {
    const r = await pedir(p);
    assert.equal(r.status, 503);
    assert.equal(JSON.parse(r.corpo).erro, 'estourou');
    assert.equal((await pedir(p)).status, 503); // continua de pé
  } finally {
    await saude.parar();
  }
});

// ── Boot do index.js com configuração inválida ───────────────────────────────
test('index.js: tenant inexistente derruba a subida com código 1, mensagem clara e sem conectar ao Discord', () => {
  const r = spawnSync(process.execPath, ['index.js'], {
    cwd: RAIZ, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, TENANT: 'nao-existe', DISCORD_TOKEN: 'x', DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x' },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Configuração inválida — o bot não subiu/);
  assert.match(r.stderr, /Tenant "nao-existe" não encontrado: esperado tenants\/nao-existe\/tenant\.js/);
});

test('index.js: LOG_FORMATO=json faz até o erro de subida sair como JSON com tenant e módulo', () => {
  const r = spawnSync(process.execPath, ['index.js'], {
    cwd: RAIZ, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, TENANT: 'nao-existe', LOG_FORMATO: 'json', DISCORD_TOKEN: 'x', DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x' },
  });
  assert.equal(r.status, 1);
  const linha = JSON.parse(r.stderr.trim().split('\n').find(l => l.startsWith('{')));
  assert.equal(linha.nivel, 'error');
  assert.equal(linha.tenant, 'nao-existe');
  assert.equal(linha.modulo, 'boot');
  assert.match(linha.erro.mensagem, /não encontrado/);
});

test('index.js: sem DISCORD_TOKEN/DATABASE_URL avisa quais faltam e sai com 1 (rodando FORA do repositório, sem .env)', () => {
  // ATENÇÃO: nunca rode o index.js com o cwd do repositório sem definir as duas variáveis:
  // o dotenv leria o .env REAL e o bot de produção subiria de verdade. Aqui o cwd é uma
  // pasta vazia (sem .env) e o processo herda um ambiente sem as variáveis.
  const vazia = fs.mkdtempSync(path.join(os.tmpdir(), 'sem-env-'));
  const env = { ...process.env };
  delete env.DISCORD_TOKEN;
  delete env.DATABASE_URL;
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'index.js')], { cwd: vazia, encoding: 'utf8', timeout: 30000, env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Faltam variáveis de ambiente: DISCORD_TOKEN, DATABASE_URL/);
});

// ── Ligação do health dentro do boot da plataforma ───────────────────────────
test('plataforma.subir com HEALTH_PORT abre o /health de verdade (aqui degradado: banco falso e Discord fora)', () => {
  const codigo = `
    process.env.DATABASE_URL = 'postgres://teste:teste@127.0.0.1:1/teste';
    process.env.DATABASE_SSL = 'off';
    const http = require('http');
    const plataforma = require('./plataforma');
    const client = { commands: null, on() {}, once() {}, isReady: () => false };
    const original = console.log;
    let porta = null;
    console.log = (...a) => { const m = /porta ([0-9]+)/.exec(a.join(' ')); if (m) porta = Number(m[1]); };
    plataforma.subir(client);
    const esperar = setInterval(() => {
      if (!porta) return;
      clearInterval(esperar);
      console.log = original;
      http.get({ host: '127.0.0.1', port: porta, path: '/health' }, res => {
        let corpo = '';
        res.on('data', d => { corpo += d; });
        res.on('end', () => { console.log(JSON.stringify({ status: res.statusCode, corpo: JSON.parse(corpo) })); process.exit(0); });
      });
    }, 20);
    setTimeout(() => { console.log = original; console.log(JSON.stringify({ erro: 'sem porta' })); process.exit(2); }, 8000);`;
  const r = spawnSync(process.execPath, ['-e', codigo], {
    cwd: RAIZ, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, TENANT: '_instalacao', HEALTH_PORT: '0', HEALTH_HOST: '127.0.0.1', DISCORD_TOKEN: 'x' },
  });
  const saida = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(saida.status, 503);
  assert.equal(saida.corpo.status, 'degradado');
  assert.equal(saida.corpo.tenant, '_instalacao');
  assert.equal(saida.corpo.modoInstalacao, true);
  assert.equal(saida.corpo.discord.pronto, false);
  assert.equal(saida.corpo.banco.ok, false);
  assert.deepEqual(Object.keys(saida.corpo).sort(), ['banco', 'discord', 'modoInstalacao', 'modulos', 'status', 'tenant', 'uptimeSeg']);
});

// ── /status ──────────────────────────────────────────────────────────────────
test('/status: comando de liderança monta o embed a partir do banco (stubs) e respeita a permissão', async () => {
  const caminho = name => require.resolve(path.join(RAIZ, name));
  const stub = (rel, exportado) => { require.cache[caminho(rel)] = { id: caminho(rel), filename: caminho(rel), loaded: true, exports: exportado }; };
  process.env.DATABASE_URL = 'postgres://teste:teste@127.0.0.1:1/teste';
  const config = require('../config/index.js');
  const canalLog = config.logsJogo.canais[0];

  stub('utils/db.js', {
    query: async sql => {
      if (/SELECT 1/.test(sql)) return { rows: [{ '?column?': 1 }] };
      if (/FROM tarefas_agendadas/.test(sql)) return { rows: [{ status: 'pendente', n: 3 }, { status: 'erro', n: 1 }] };
      throw new Error(`consulta inesperada: ${sql}`);
    },
  });
  stub('utils/logsJogo/repositorio.js', { ultimaOcorrenciaPorCanal: async () => new Map([[canalLog, new Date(Date.now() - 3600 * 1000)]]) });
  stub('plataforma/index.js', { ativos: [{ id: 'logsJogo' }, { id: 'nucleo' }], desligados: [], idsAtivos: new Set(['logsJogo', 'nucleo']) });

  const comando = require('../commands/status');
  assert.equal(comando.data.name, 'status');

  const respostas = [];
  const membroSemPermissao = { permissions: { has: () => false }, roles: { cache: new Map() } };
  await comando.execute({ member: membroSemPermissao, reply: async p => { respostas.push(['reply', p]); }, deferReply: async () => {}, editReply: async p => { respostas.push(['edit', p]); } });
  assert.match(respostas[0][1].content, /APENAS A LIDERANÇA/);

  respostas.length = 0;
  const admin = { permissions: { has: () => true }, roles: { cache: new Map() } };
  await comando.execute({ member: admin, reply: async () => {}, deferReply: async () => {}, editReply: async p => { respostas.push(p); } });
  const embed = respostas[0].embeds[0];
  const texto = embed.description;
  assert.match(embed.title, /STATUS DO BOT/);
  assert.match(texto, /respondendo/);
  assert.match(texto, /3 pendente\(s\)/);
  assert.match(texto, /1 tarefa\(s\) desistiram/);
  assert.match(texto, /último log há 1h/);
  assert.match(texto, /2 ligados/);
  assert.match(texto, /ITEM\(NS\) PRECISAM DE ATENÇÃO/); // a tarefa desistente conta como problema
});
