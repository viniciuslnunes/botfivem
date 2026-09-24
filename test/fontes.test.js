// Fontes de logs (fontes/<id>/): contrato, carregador, adapter Hoolibras contra
// amostras reais e o desacoplamento do resto do bot (que só fala com a fonte
// por utils/logsJogo/fonte.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
process.env.DATABASE_URL = 'postgres://teste:teste@127.0.0.1:1/teste';

const { ACOES_CANONICAS, validarFonte, validarRegistro } = require('../fontes/contrato');
const { carregarFonte } = require('../fontes');
const hoolibras = require('../fontes/hoolibras');

const embedsReais = require('../fontes/hoolibras/amostras.json');
const embedsSinteticos = require('../fontes/hoolibras/amostras-sinteticas.json');
const amostras = [...embedsReais, ...embedsSinteticos];

// ── Contrato ─────────────────────────────────────────────────────────────────
test('validarFonte: aceita o adapter Hoolibras e lista todos os defeitos de um adapter ruim', () => {
  assert.deepEqual(validarFonte(hoolibras, 'hoolibras'), []);
  const erros = validarFonte({ id: 'outro', nome: '', parseRegistro: 1 }, 'hoolibras');
  for (const trecho of ['difere da pasta', 'nome obrigatório', 'parseRegistro', 'nomePatrimonio']) {
    assert.ok(erros.some(e => e.includes(trecho)), `deveria citar ${trecho}: ${erros}`);
  }
  assert.deepEqual(validarFonte(null), ['a fonte deve exportar um objeto']);
});

test('validarRegistro: forma do registro canônico', () => {
  const ok = { acao: 'bau_guardou', categoria: 'bau', atorNome: null, alvoNome: 'tecido', atorIdFivem: '5', alvoIdFivem: null, valor: 3, titulo: 'Guardou [X]', descricao: null };
  assert.deepEqual(validarRegistro(ok), []);

  const ruim = validarRegistro({ acao: 'inventada', categoria: 5, atorIdFivem: 'abc', valor: NaN });
  for (const trecho of ['fora do vocabulário', 'categoria deve ser texto', 'atorIdFivem deve ser só dígitos', 'valor deve ser número', 'alvoNome ausente']) {
    assert.ok(ruim.some(e => e.includes(trecho)), `deveria citar ${trecho}: ${ruim}`);
  }
  assert.ok(validarRegistro({ ...ok, acao: '' }).some(e => e.includes('acao obrigatória')));
  assert.deepEqual(validarRegistro(null), ['registro deve ser um objeto']);
  // categoria nova no rodapé do jogo não é erro (o painel de categorias mostra o que vier)
  assert.deepEqual(validarRegistro({ ...ok, categoria: 'categoria_nova_do_jogo' }), []);
});

// ── Carregador ───────────────────────────────────────────────────────────────
test('carregarFonte: carrega hoolibras; erros dizem o que fazer', () => {
  assert.equal(carregarFonte('hoolibras').id, 'hoolibras');
  assert.throws(() => carregarFonte('naoexiste'), /não encontrada: esperado fontes\/naoexiste\/index\.js \(disponíveis: hoolibras\)/);
  for (const ruim of ['../x', 'a/b', '', undefined, 5]) assert.throws(() => carregarFonte(ruim), /jogo\.fonte inválida/);
});

test('carregarFonte: adapter que não cumpre o contrato derruba a subida com a lista de defeitos', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'fontes-'));
  fs.mkdirSync(path.join(raiz, 'ruim'));
  fs.writeFileSync(path.join(raiz, 'ruim', 'index.js'), "module.exports = { id: 'ruim', nome: 'Ruim' };");
  assert.throws(() => carregarFonte('ruim', { raiz }), /inválida[\s\S]*parseRegistro[\s\S]*nomePatrimonio/);
});

// ── Adapter Hoolibras contra amostras ────────────────────────────────────────
test('hoolibras: cada amostra produz exatamente o registro guardado (rede contra regressão do parser)', () => {
  assert.ok(amostras.length >= 68, `esperava >= 68 amostras, há ${amostras.length}`);
  const diferentes = [];
  for (const { embed, registro } of amostras) {
    const obtido = JSON.parse(JSON.stringify(hoolibras.parseRegistro(embed)));
    if (JSON.stringify(obtido) !== JSON.stringify(registro)) diferentes.push({ embed, esperado: registro, obtido });
  }
  assert.deepEqual(diferentes, []);
});

test('hoolibras: todo registro produzido cumpre o contrato canônico', () => {
  for (const { embed, registro } of amostras) {
    assert.deepEqual(validarRegistro(registro), [], JSON.stringify(embed));
    assert.deepEqual(validarRegistro(hoolibras.parseRegistro(embed)), [], JSON.stringify(embed));
  }
});

test('hoolibras: há amostra de TODA ação do vocabulário canônico (nenhuma regra sem teste de formato)', () => {
  const cobertas = new Set(amostras.map(a => a.registro.acao));
  assert.deepEqual([...ACOES_CANONICAS].filter(a => !cobertas.has(a)), []);
  assert.deepEqual([...cobertas].filter(a => !ACOES_CANONICAS.has(a)), []);
});

test('hoolibras: amostras sintéticas estão marcadas como tais (não fingem ser log real)', () => {
  assert.ok(embedsSinteticos.length > 0 && embedsSinteticos.every(a => a.sintetica === true));
  assert.ok(embedsReais.every(a => a.sintetica === undefined));
});

test('hoolibras: nomePatrimonio reconhece os dois formatos e rejeita item comum', () => {
  const { nomePatrimonio } = hoolibras;
  assert.equal(nomePatrimonio('GDF Mastro 01'), 'GDF Mastro 01');
  assert.equal(nomePatrimonio('hoolibras_gdf_quadrada_01'), 'GDF Bandeira Quadrada 01');
  assert.equal(nomePatrimonio('Munição de Pistola'), null);
  assert.equal(nomePatrimonio(''), null);
  assert.equal(nomePatrimonio(null), null);
});

// ── Desacoplamento ───────────────────────────────────────────────────────────
test('nenhum módulo do bot importa uma fonte diretamente; só utils/logsJogo/fonte.js (via fontes/index)', () => {
  function js(dir) {
    return fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap(e => {
      const rel = path.posix.join(dir, e.name);
      return e.isDirectory() ? js(rel) : e.name.endsWith('.js') ? [rel] : [];
    });
  }
  const infratores = [];
  for (const arq of ['utils', 'commands', 'modulos', 'plataforma'].flatMap(js)) {
    const src = fs.readFileSync(path.join(RAIZ, arq), 'utf8');
    if (/require\([^)]*fontes\/hoolibras/.test(src)) infratores.push(arq);
  }
  assert.deepEqual(infratores, []);
});

// ── Ponta a ponta com uma fonte FALSA: o bot funciona sem saber de Hoolibras ──
function stub(relativo, exportado) {
  const p = require.resolve(path.join(RAIZ, relativo));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportado };
}

test('ingestão usa a fonte do tenant: adapter falso alimenta registros e reprocessamento', async () => {
  const fonteFalsa = {
    id: 'falsa', nome: 'Servidor Falso',
    parseRegistro: embed => ({
      acao: /entrou/i.test(embed?.description ?? '') ? 'jogador_entrou' : 'desconhecido',
      categoria: 'conexao', atorNome: 'Fulano', atorIdFivem: '77', alvoNome: null, alvoIdFivem: null,
      valor: null, titulo: embed?.title ?? null, descricao: embed?.description ?? null,
    }),
    nomePatrimonio: () => null,
  };
  assert.deepEqual(validarFonte(fonteFalsa, 'falsa'), []);

  const atualizados = [];
  stub('utils/db.js', { query: async () => { throw new Error('teste tocou no banco'); } });
  stub('utils/logsJogo/fonte.js', fonteFalsa);
  stub('utils/logsJogo/repositorio.js', {
    desconhecidosComBruto: async () => [
      { id: 1, bruto: { description: 'Fulano entrou no servidor' } },
      { id: 2, bruto: { description: 'nada reconhecível' } },
    ],
    atualizarRegistroReprocessado: async (id, novo) => { atualizados.push([id, novo.acao]); },
  });
  const config = require('../config');
  const ingestao = require('../utils/logsJogo/ingestao');

  const canal = config.logsJogo.canais[0];
  const mensagem = {
    id: '1', channelId: canal, webhookId: 'w', author: { username: 'bot' }, createdAt: new Date('2026-01-01T00:00:00Z'),
    embeds: [{ data: { title: 'Registro', description: 'Fulano entrou no servidor' } }],
  };
  assert.equal(ingestao.ehMensagemDeLog(mensagem), true);
  const [registro] = ingestao.registrosDaMensagem(mensagem);
  assert.equal(registro.acao, 'jogador_entrou');
  assert.equal(registro.atorIdFivem, '77');
  assert.equal(registro.canalId, canal);
  assert.equal(registro.messageId, '1');
  assert.deepEqual(validarRegistro(registro), []);

  assert.deepEqual(await ingestao.reprocessarDesconhecidos(), { lidos: 2, corrigidos: 1 });
  assert.deepEqual(atualizados, [[1, 'jogador_entrou']]);
});
