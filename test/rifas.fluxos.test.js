// Rifas pelo painel do canal, de ponta a ponta: handlers REAIS, Postgres em
// memória e Discord falso. Cobre a montagem dos canais, a criação por modal e a
// gestão (select → ações) sem passar por slash command.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_SSL = 'off';
const { instalarBanco } = require('../tools/banco-em-memoria');
const { criarMembro, criarServidor, criarInteracao } = require('../tools/discord-falso');
const { PermissionFlagsBits } = require('discord.js');

let banco;
let despachar;
let config;
let estrutura;
let guild;
let gestor;
let socio;
let canalRifas;

test.before(async () => {
  banco = await instalarBanco();
  config = require('../config/index.js');
  require('../plataforma').carregarModulos({ commands: null });
  ({ despacharInteracao: despachar } = require('../utils/modulos'));
  estrutura = require('../utils/rifas/estrutura');

  gestor = criarMembro('900000000000000020', { nome: 'Presidente', cargos: [config.cargos.presidente], permissoes: [PermissionFlagsBits.Administrator] });
  socio = criarMembro('900000000000000021', { nome: 'Beltrano', cargos: [config.cargos.socio] });
  guild = criarServidor({ canais: [], membros: [gestor, socio] });
});
test.after(async () => { await banco.pglite.close(); });

const enviar = async i => { assert.equal(await despachar(i), true); return i; };
const clicar = (customId, membro = gestor, extra = {}) => enviar(criarInteracao({ customId, membro, guild, canal: canalRifas, ...extra }));
const modal = (customId, campos, membro = gestor) => clicar(customId, membro, { tipo: 'modal', campos });
const rifaId = async () => (await banco.q('SELECT id FROM rifas ORDER BY id DESC LIMIT 1'))[0].id;

test('estrutura: cria o canal público e o privado, com o painel no fim do público', async () => {
  const resumo = await estrutura.montarEstruturaRifas(guild);
  assert.ok(resumo.some(l => /Canal de rifas criado/.test(l)));
  canalRifas = guild.channels.cache.find(c => c.name === '🎟️・rifas');
  assert.ok(canalRifas);
  assert.ok(guild.channels.cache.find(c => c.name === '🎟️・rifas-pagamentos'));
  const botoes = canalRifas.enviadas[0].components[0].components.map(c => c.data.custom_id);
  assert.deepEqual(botoes, ['rifa:lista', 'rifa:novo', 'rifa:gerir']);

  // idempotente: subir de novo não cria canal nem painel repetido
  const de_novo = await estrutura.montarEstruturaRifas(guild);
  assert.ok(de_novo.every(l => !/criado/.test(l)));
  assert.equal(canalRifas.enviadas.filter(m => !m.apagada).length, 1);
});

test('nova rifa: só a gestão; o modal publica no canal de rifas e devolve o painel ao fim', async () => {
  const barrado = await clicar('rifa:novo', socio);
  assert.match(barrado.acao('reply')[0].content, /SÓ A PRESIDÊNCIA/);
  assert.equal((await clicar('rifa:novo')).registros[0][0], 'showModal');

  const invalida = await modal('rifa:m_novo', { titulo: 'X', premio: 'Moto', preco: '500', numeros: 'abc', encerra: '' });
  assert.match(invalida.acao('reply')[0].content, /INVÁLIDA/);
  assert.equal((await banco.q('SELECT count(*)::int AS n FROM rifas'))[0].n, 0);

  const ok = await modal('rifa:m_novo', { titulo: 'Moto de gala', premio: 'Uma moto', preco: '500', numeros: '100', encerra: '' });
  assert.match(ok.acao('editReply')[0].content, /PUBLICADA EM/);
  const [r] = await banco.q('SELECT * FROM rifas');
  assert.equal(r.canal_id, canalRifas.id);
  assert.equal(r.total_numeros, 100);
  const vivas = canalRifas.enviadas.filter(m => !m.apagada);
  assert.equal(vivas.length, 2);
  assert.equal(vivas[1].components[0].components[1].data.custom_id, 'rifa:novo'); // painel por último
});

test('gerir: select → ações; encerrar vendas atualiza a rifa e cancelar avisa por modal', async () => {
  const barrado = await clicar('rifa:gerir', socio);
  assert.match(barrado.acao('reply')[0].content, /SÓ A LIDERANÇA/);

  const abre = await clicar('rifa:gerir');
  assert.equal(abre.acao('reply')[0].components[0].components[0].options.length, 1);

  const id = await rifaId();
  const sel = await clicar('rifa:g_sel', gestor, { tipo: 'select', valores: [String(id)] });
  assert.match(sel.acao('update')[0].content, /Moto de gala/);

  const enc = await clicar(`rifa:g_encerrar:${id}`);
  assert.match(enc.acao('editReply')[0].content, /ENCERRADAS/);
  assert.equal((await banco.q('SELECT status FROM rifas WHERE id = $1', [id]))[0].status, 'ENCERRADA');

  const rel = await clicar(`rifa:g_relatorio:${id}`);
  assert.match(rel.acao('editReply')[0].embeds[0].title, /RIFA #/);

  assert.equal((await clicar(`rifa:g_cancelar:${id}`)).registros[0][0], 'showModal');
  const canc = await modal(`rifa:m_cancelar:${id}`, { motivo: 'Teste' });
  assert.match(canc.acao('editReply')[0].content, /CANCELADA/);
  assert.equal((await banco.q('SELECT status FROM rifas WHERE id = $1', [id]))[0].status, 'CANCELADA');
});
