// Sequência de divulgações de recrutamento: registro dos posts, quem tem liberação de
// postar e rodízio, contra Postgres em memória e Discord falso.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_SSL = 'off';
const { instalarBanco } = require('../tools/banco-em-memoria');
const { criarCanal, criarMembro, criarServidor, criarMensagem } = require('../tools/discord-falso');
const { montarSequencia, contarPorAutor, analisarRodizio, semLiberacao } = require('../utils/recrutamento/divulgacaoRegras');

const CANAL_ID = '777000000000000001';
const HORA = 3600 * 1000;
const agora = new Date('2026-09-24T12:00:00Z');
const antes = h => new Date(agora - h * HORA);

let banco;
let config;
let painel;
let repo;

test.before(async () => {
  banco = await instalarBanco();
  config = require('../config/index.js');
  // config é congelado: o painel enxerga uma cópia com o canal de divulgação ligado
  const caminho = require.resolve('../config/index.js');
  require.cache[caminho] = { ...require.cache[caminho], exports: { ...config, canais: { ...config.canais, divulgacaoRecrutamento: CANAL_ID } } };
  require('../plataforma').carregarModulos({ commands: null });
  painel = require('../utils/recrutamento/painelDivulgacao');
  repo = require('../utils/recrutamento/divulgacaoRepositorio');
});
test.after(async () => { await banco.pglite.close(); });

test('regras: sequência com intervalo, contagem e rodízio', () => {
  const posts = [
    { autor_id: 'B', postado_em: antes(1) },
    { autor_id: 'B', postado_em: antes(3) },
    { autor_id: 'A', postado_em: antes(24 * 10) },
  ];
  const seq = montarSequencia(posts);
  assert.equal(seq[0].intervaloMs, 2 * HORA);
  assert.equal(seq[2].intervaloMs, null);
  assert.equal(contarPorAutor(posts).get('B'), 2);

  const r = analisarRodizio({ liberados: ['A', 'B', 'C'], posts, agora });
  assert.equal(r.repetiuSeguido, 'B', 'B postou duas vezes seguidas');
  assert.deepEqual(r.ordem, ['C', 'A', 'B'], 'quem nunca postou vem primeiro; depois o mais antigo');
  assert.equal(r.proximo, 'C');
  assert.deepEqual(r.sumidos, ['C', 'A'], 'C nunca postou; A há mais de 7 dias');

  // o último a postar nunca é o próximo, mesmo sendo o único mais antigo
  assert.equal(analisarRodizio({ liberados: ['B'], posts, agora }).proximo, null);
  assert.deepEqual(semLiberacao(posts, ['B']), ['A']);
});

test('divulgação: só o canal certo registra, bot é ignorado, reenvio não duplica', async () => {
  const outro = criarCanal('123', 'geral');
  const canal = criarCanal(CANAL_ID, 'divulgacao');
  const msg = criarMensagem(canal, {}, { id: 'R1', bot: false });
  msg.createdAt = antes(2);
  assert.equal(await painel.aoMensagem(msg), false, 'nunca consome a mensagem');
  await painel.aoMensagem(msg);
  const errada = criarMensagem(outro, {}, { id: 'R2', bot: false });
  errada.createdAt = agora;
  await painel.aoMensagem(errada);
  await painel.aoMensagem(criarMensagem(canal, {}, { id: 'BOT', bot: true }));
  const posts = await repo.ultimosPosts();
  assert.deepEqual(posts.map(p => p.autor_id), ['R1']);
});

test('painel: mostra quem tem liberação de postar, próximo da vez e alerta de repetição', async () => {
  const rec = config.cargos.recrutador;
  const liberado = criarMembro('R1', { cargos: [rec] });
  const liberado2 = criarMembro('R3', { cargos: [rec] });
  const bloqueado = criarMembro('R4', { cargos: [rec] });
  const canal = criarCanal(CANAL_ID, 'divulgacao');
  const permitidos = new Set(['R1', 'R3']);
  canal.permissionsFor = m => ({ has: () => permitidos.has(m.id) });
  const guild = criarServidor({ canais: [canal], membros: [liberado, liberado2, bloqueado] });

  const acesso = await painel.quemPodePostar(guild.client);
  assert.deepEqual(acesso.recrutadoresLiberados.sort(), ['R1', 'R3']);
  assert.deepEqual(acesso.recrutadoresSemLiberacao, ['R4']);

  await banco.q("INSERT INTO divulgacoes_recrutamento (message_id, autor_id, postado_em) VALUES ('M1', 'R1', now() - interval '1 hour')");
  await painel.atualizarPainel(guild.client);
  const painelCanal = [...guild.channels.cache.values()].find(c => c.name === '📣・sequência-recrutamento');
  const texto = JSON.stringify(painelCanal.enviadas.map(m => m.embeds));
  assert.match(texto, /Próximo da vez:\*\* <@R3>/);
  assert.match(texto, /SEM liberação \(1\)/);
  assert.match(texto, /duas vezes seguidas/, 'R1 postou duas vezes seguidas (post do teste anterior + M1)');
});
