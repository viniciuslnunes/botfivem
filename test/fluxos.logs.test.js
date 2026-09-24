// Ingestão dos logs do jogo de ponta a ponta: mensagem de webhook no canal certo →
// pipeline real → linha em logs_jogo (Postgres em memória). Usa as amostras
// reais do adapter (fontes/hoolibras/amostras.json) como entrada e como gabarito.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_SSL = 'off';
const { instalarBanco } = require('../tools/banco-em-memoria');
const { criarCanal, criarServidor } = require('../tools/discord-falso');

let banco;
const config = require('../config/index.js');
let processar;
let guild;
let ids = 5000000000000000;

test.before(async () => {
  banco = await instalarBanco();
  ({ processarMensagemDeLog: processar } = require('../utils/logsJogo/pipeline'));
  guild = criarServidor({ canais: [criarCanal(config.logsJogo.canalAlertas, 'alertas'), criarCanal(config.canais.historicoNaoRecrutar, 'historico-nao-recrutar')] });
});

test.after(async () => {
  await new Promise(r => setTimeout(r, 400)); // deixa os painéis reativos terminarem
  await banco.pglite.close();
});

const amostras = require('../fontes/hoolibras/amostras.json');
const amostra = acao => amostras.find(a => a.registro.acao === acao);

function mensagemDeWebhook(canalId, embeds, { webhook = true } = {}) {
  const id = String(++ids);
  return {
    id, channelId: canalId, embeds,
    webhookId: webhook ? '123' : null,
    author: { bot: true, username: 'Hoolibras' },
    createdAt: new Date('2026-09-20T15:00:00Z'),
  };
}

async function receber(msg) {
  const console_ = { warn: console.warn, error: console.error, log: console.log };
  const erros = [];
  console.warn = () => {}; console.log = () => {};
  console.error = (...a) => erros.push(a.map(String).join(' '));
  try {
    const consumida = await processar(msg, guild.client, []);
    await new Promise(r => setTimeout(r, 30)); // agendamentos reativos sem await
    return { consumida, erros };
  } finally { Object.assign(console, console_); }
}

const [CANAL_PAINEL, CANAL_REGISTROS, CANAL_BAU] = config.logsJogo.canais;

test('todas as amostras reais viram exatamente o registro esperado no banco', async () => {
  let n = 0;
  for (const a of amostras) {
    if (a.registro.acao === 'desconhecido') continue;
    const r = await receber(mensagemDeWebhook(CANAL_REGISTROS, [a.embed]));
    assert.equal(r.consumida, true);
    n++;
  }
  const [{ total }] = await banco.q('SELECT count(*)::int AS total FROM logs_jogo WHERE canal_id = $1 AND descricao IS NOT NULL', [CANAL_REGISTROS]);
  assert.ok(total >= n, `${total} linhas para ${n} amostras`);

  // confere campo a campo uma amostra de cada categoria importante
  for (const acao of ['jogador_recrutou', 'jogador_entrou', 'bau_guardou', 'advertido', 'banco_depositou']) {
    const esperado = amostra(acao).registro;
    const [linha] = await banco.q('SELECT * FROM logs_jogo WHERE acao = $1 AND descricao = $2 LIMIT 1', [acao, esperado.descricao]);
    assert.ok(linha, `${acao} gravada`);
    assert.equal(linha.categoria, esperado.categoria);
    assert.equal(linha.ator_id_fivem, esperado.atorIdFivem);
    assert.equal(linha.alvo_id_fivem, esperado.alvoIdFivem);
    assert.equal(linha.alvo_nome, esperado.alvoNome);
    assert.equal(linha.valor === null ? null : Number(linha.valor), esperado.valor);
  }
});

test('o mesmo log recebido duas vezes (webhook repetido / bot reiniciado) é gravado uma vez só', async () => {
  const msg = mensagemDeWebhook(CANAL_BAU, [amostra('bau_removeu').embed]);
  await receber(msg);
  await receber(msg);
  const [{ n }] = await banco.q('SELECT count(*)::int AS n FROM logs_jogo WHERE message_id = $1', [msg.id]);
  assert.equal(n, 1);
});

test('mensagem que não é log (canal fora da lista, sem webhook, sem embed) é ignorada e não grava nada', async () => {
  const antes = (await banco.q('SELECT count(*)::int AS n FROM logs_jogo'))[0].n;
  const embed = amostra('jogador_entrou').embed;
  assert.equal((await receber(mensagemDeWebhook('1461544673825783929', [embed]))).consumida, false); // logs-liderança (Fanáticos)
  const humano = mensagemDeWebhook(CANAL_PAINEL, [embed], { webhook: false });
  humano.author = { bot: false, username: 'alguem' };
  assert.equal((await receber(humano)).consumida, false);
  assert.equal((await receber(mensagemDeWebhook(CANAL_PAINEL, []))).consumida, false);
  assert.equal((await banco.q('SELECT count(*)::int AS n FROM logs_jogo'))[0].n, antes);
});

test('recrutamento no jogo grava também a entrada implícita do recrutado (presença)', async () => {
  const embed = { title: 'Recrutamento', description: '#77001 Recrutador Teste recrutou #77002 Recruta Teste.' };
  const r = await receber(mensagemDeWebhook(CANAL_REGISTROS, [embed]));
  assert.deepEqual(r.erros, []);
  const linhas = await banco.q("SELECT acao, ator_id_fivem FROM logs_jogo WHERE (acao = 'jogador_entrou' AND ator_id_fivem = '77002') OR descricao LIKE '%Recruta Teste%' ORDER BY id");
  assert.deepEqual(linhas.map(l => l.acao).sort(), ['jogador_entrou', 'jogador_recrutou']);
});

test('embed que o parser não conhece é gravado como "desconhecido" (nada se perde) sem derrubar o pipeline', async () => {
  const r = await receber(mensagemDeWebhook(CANAL_REGISTROS, [{ title: 'Coisa Nova', description: 'Algo que nenhuma regra reconhece 12345' }]));
  assert.equal(r.consumida, true);
  assert.deepEqual(r.erros, []);
  const [linha] = await banco.q("SELECT acao FROM logs_jogo WHERE descricao LIKE '%nenhuma regra reconhece%'");
  assert.equal(linha.acao, 'desconhecido');
});
