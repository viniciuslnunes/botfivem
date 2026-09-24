const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { carregarTenant } = require('../config/carregar');
const { validarTenant } = require('../config/schema');

const RAIZ = path.join(__dirname, '..');

// Roda um trecho de código num processo novo com TENANT definido: é o único
// jeito honesto de provar reatividade (o tema é lido na subida do processo).
function noTenant(slug, codigo) {
  const saida = execFileSync(process.execPath, ['-e', codigo], {
    cwd: RAIZ,
    env: { ...process.env, TENANT: slug, DATABASE_URL: 'postgres://x:x@127.0.0.1:1/x', DISCORD_TOKEN: 'x' },
    encoding: 'utf8',
  });
  return JSON.parse(saida.trim().split('\n').pop());
}

// Cópia editável do tenant _exemplo numa pasta temporária.
function tenantTemporario(mutar) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'tenants-'));
  fs.mkdirSync(path.join(raiz, 't'));
  const t = structuredClone(require('../tenants/_exemplo/tenant.js'));
  t.slug = 't';
  mutar?.(t);
  fs.writeFileSync(path.join(raiz, 't', 'tenant.js'), `module.exports = ${JSON.stringify(t)};`);
  return raiz;
}

test('tenant gavioes: passa no schema e sai congelado', () => {
  const c = carregarTenant('gavioes');
  assert.equal(c.slug, 'gavioes');
  assert.ok(Object.isFrozen(c) && Object.isFrozen(c.canais) && Object.isFrozen(c.logsJogo.farm));
  assert.throws(() => { 'use strict'; c.canais.recrutamento = '1'; }, TypeError);
});

test('tenant _exemplo (torcida fictícia) também passa no schema', () => {
  assert.equal(carregarTenant('_exemplo').slug, '_exemplo');
});

test('config/index.js entrega o mesmo formato que os módulos sempre usaram', () => {
  const config = require('../config/index.js');
  for (const k of ['guildId', 'canais', 'cargos', 'categorias', 'links', 'hierarquia', 'lideranca', 'departamentos', 'eventos', 'carteirinha', 'logsJogo', 'antiSpam', 'confianca', 'memoria']) {
    assert.ok(k in config, `config.${k} ausente`);
  }
  assert.equal(config.canais.telefoneSocio, '1330996902887555133');
  assert.ok(config.links.redesSociais.startsWith('https://'));
});

test('schema lista TODOS os problemas de uma vez', () => {
  const raiz = tenantTemporario(t => {
    delete t.guildId;
    t.cargos.presidente = 'abc';
    t.canais.recrutamento = 12345;
    t.lideranca = [];
    t.logsJogo.canais = [];
    t.logsJogo.fonteParadaDias = 0;
    t.departamentos.push({ ...t.departamentos[0] }); // slug repetido
    t.antiSpam.modo = 'talvez';
  });
  assert.throws(() => carregarTenant('t', { raiz }), err => {
    for (const trecho of ['guildId', 'cargos.presidente', 'canais.recrutamento', 'lideranca', 'logsJogo.canais', 'logsJogo.fonteParadaDias', 'repetido', 'antiSpam.modo']) {
      assert.ok(err.message.includes(trecho), `deveria citar "${trecho}":\n${err.message}`);
    }
    return true;
  });
});

test('schema: slug diferente da pasta, nomesCanais fora de canais e itensDroga fora de itens', () => {
  const t = structuredClone(require('../tenants/_exemplo/tenant.js'));
  t.logsJogo.nomesCanais = { '999999999999999999': 'x' };
  t.logsJogo.farm.itensDroga = ['pó'];
  const erros = validarTenant(t, 'outra');
  assert.ok(erros.some(e => e.startsWith('slug:')));
  assert.ok(erros.some(e => e.includes('nomesCanais')));
  assert.ok(erros.some(e => e.includes('itensDroga')));
});

test('tenant inexistente: erro claro dizendo o arquivo esperado', () => {
  assert.throws(() => carregarTenant('nao-existe'), /Tenant "nao-existe" não encontrado: esperado tenants\/nao-existe\/tenant\.js/);
});

test('erro DENTRO do tenant.js não é mascarado como "não encontrado"', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'tenants-'));
  fs.mkdirSync(path.join(raiz, 'q'));
  fs.writeFileSync(path.join(raiz, 'q', 'tenant.js'), "require('modulo-que-nao-existe-xyz');");
  assert.throws(() => carregarTenant('q', { raiz }), err => !/não encontrado: esperado tenants/.test(err.message) && /modulo-que-nao-existe-xyz/.test(err.message));
});

test('TENANT com path traversal é recusado', () => {
  for (const ruim of ['../x', 'a/b', '..\\x', 'a b']) {
    assert.throws(() => execFileSync(process.execPath, ['-e', "require('./tenants/ativo')"], {
      cwd: RAIZ, env: { ...process.env, TENANT: ruim }, stdio: 'pipe',
    }), /TENANT inválido|Command failed/, ruim);
  }
});

test('REATIVIDADE: o mesmo código de cartão e gráfico muda de cor conforme o tenant', () => {
  const codigo = `
    const { createCanvas, loadImage } = require('canvas');
    (async () => {
      const { gerarCarteirinha } = require('./utils/gerarCarteirinha');
      const { gerarGraficoOcupacao } = require('./utils/logsJogo/graficoOcupacao');
      const px = async (buf, x, y) => {
        const im = await loadImage(buf); const c = createCanvas(im.width, im.height);
        const g = c.getContext('2d'); g.drawImage(im, 0, 0);
        return [...g.getImageData(x, y, 1, 1).data].slice(0, 3);
      };
      const card = await gerarCarteirinha({ nome: 'X', numeroSocio: 1, validade: '01/01/2030', avatarUrl: null });
      const grafico = gerarGraficoOcupacao([{ chave: '2026-01-01', pico: 3 }, { chave: '2026-01-02', pico: 5 }], 'dia');
      const config = require('./config');
      const tema = require('./tema');
      const F = require('./utils/logsJogo/painelFormato');
      console.log(JSON.stringify({
        faixaCartao: await px(card, 400, 312),   // faixa decorativa (tinta do cartão)
        fundoGrafico: await px(grafico, 697, 277), // canto inferior direito do gráfico (fundo)
        corEmbedPainel: F.COR, guild: config.guildId, marca: tema.marca.nome, ativo: tema.emoji.ativo,
      }));
    })();`;
  const g = noTenant('gavioes', codigo);
  const v = noTenant('_exemplo', codigo);

  assert.deepEqual(g.faixaCartao, [0, 0, 0]); // Gaviões: preto
  assert.deepEqual(v.faixaCartao, [0x0B, 0x66, 0x23]); // exemplo: verde
  assert.deepEqual(g.fundoGrafico, [0, 0, 0]);
  assert.deepEqual(v.fundoGrafico, [0x06, 0x28, 0x0F]);
  assert.equal(g.corEmbedPainel, 0x000000);
  assert.equal(v.corEmbedPainel, 0x0B6623);
  assert.notEqual(g.guild, v.guild);
  assert.equal(g.marca, 'GAVIÕES DA FIEL FIVEM');
  assert.equal(v.marca, 'MANCHA VERDE EXEMPLO FIVEM');
  assert.equal(g.ativo, '🦅');
  assert.equal(v.ativo, '🟢');
});

// (O carregamento completo do tenant _exemplo, que não tem elenco nem vários módulos,
// é coberto em test/paridade.test.js: a plataforma só carrega os módulos ligados.)
