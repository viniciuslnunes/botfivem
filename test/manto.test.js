// Avaliação da foto do manto (provar-manto) e placar por recrutador, ponta a ponta
// contra Postgres em memória e Discord falso (nada toca o banco ou o Discord reais).
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_SSL = 'off';
const { instalarBanco } = require('../tools/banco-em-memoria');
const { criarCanal, criarMembro, criarServidor, criarInteracao, criarMensagem, Colecao } = require('../tools/discord-falso');
const { montarPlacar, taxaDeAcerto } = require('../utils/recrutamento/mantoRegras');

let banco;
let config;
let despachar;
let painelManto;

test.before(async () => {
  banco = await instalarBanco();
  config = require('../config/index.js');
  require('../plataforma').carregarModulos({ commands: null });
  ({ despacharInteracao: despachar } = require('../utils/modulos'));
  painelManto = require('../utils/recrutamento/painelManto');
});
test.after(async () => { await banco.pglite.close(); });

test('regras: taxa e placar (zerados aparecem, ordena por avaliadas)', () => {
  assert.equal(taxaDeAcerto({ acertos: 0, erros: 0 }), null);
  assert.equal(taxaDeAcerto({ acertos: 3, erros: 1 }), 75);
  const { recrutadores, semRecrutador } = montarPlacar(
    [{ recrutador_id: 'A', acertos: 1, erros: 0 }, { recrutador_id: 'B', acertos: 2, erros: 2 }, { recrutador_id: null, acertos: 0, erros: 1 }],
    ['A', 'B', 'C']
  );
  assert.deepEqual(recrutadores.map(r => r.id), ['B', 'A', 'C']);
  assert.deepEqual(semRecrutador, { acertos: 0, erros: 1 });
});

test('manto: foto ganha botões; só liderança/gestor avalia; placar conta para quem decidiu a ficha', async () => {
  const candidato = criarMembro('910000000000000001', { nome: 'Cand' });
  const recrutador = criarMembro('910000000000000002', { nome: 'Rec', cargos: [config.cargos.recrutador] });
  const lider = criarMembro('910000000000000003', { nome: 'Lider', cargos: [config.cargos.diretoria] });
  const comum = criarMembro('910000000000000004', { nome: 'Comum', cargos: [config.cargos.socio] });
  const provar = criarCanal(config.canais.provarManto, 'provar-manto');
  const guild = criarServidor({ canais: [provar], membros: [candidato, recrutador, lider, comum] });

  // ficha aprovada pelo recrutador, criada antes da foto
  await banco.q(
    `INSERT INTO fichas_recrutamento (message_id, discord_id, status, decidido_por_id, criado_em)
     VALUES ('F1', $1, 'APROVADO', $2, now() - interval '5 minutes')`, [candidato.id, recrutador.id]
  );

  const foto = criarMensagem(provar, {}, { id: candidato.id, bot: false });
  foto.attachments = new Colecao([['a', { contentType: 'image/png' }]]);
  foto.createdAt = new Date();
  foto.client = guild.client;
  provar.historico.unshift(foto);
  assert.equal(await painelManto.aoMensagem(foto), false, 'nunca consome a mensagem');
  const aviso = provar.enviadas.at(-1);
  assert.match(aviso.content, /Avaliação do manto/);
  assert.equal(aviso.components[0].components.length, 2);

  const semPermissao = criarInteracao({ customId: `mantoaval:certo:${foto.id}`, membro: comum, guild, canal: provar, mensagem: aviso });
  await despachar(semPermissao);
  assert.match(semPermissao.acao('reply')[0].content, /APENAS A LIDERANÇA/);
  assert.equal((await banco.q('SELECT count(*)::int AS n FROM mantos_avaliados WHERE resultado IS NOT NULL'))[0].n, 0);

  const errado = criarInteracao({ customId: `mantoaval:errado:${foto.id}`, membro: lider, guild, canal: provar, mensagem: aviso });
  await despachar(errado);
  assert.match(errado.acao('update')[0].content, /MANTO ERRADO/);
  assert.equal(errado.acao('update')[0].components.length, 1, 'errado mantém os botões pra corrigir');
  const [tarefa] = await banco.q("SELECT payload, executar_em > now() + interval '9 minutes' AS em_10min FROM tarefas_agendadas WHERE tipo = 'manto_remover_botoes'");
  assert.ok(tarefa?.em_10min, 'errado agenda a remoção dos botões para daqui a ~10 min');
  assert.equal(tarefa.payload.mensagemId, aviso.id);
  // correção: o último clique vale
  const certo = criarInteracao({ customId: `mantoaval:certo:${foto.id}`, membro: lider, guild, canal: provar, mensagem: aviso });
  await despachar(certo);
  assert.match(certo.acao('update')[0].content, /MANTO CORRETO/);
  assert.deepEqual(certo.acao('update')[0].components, [], 'validado: botões somem');

  const repo = require('../utils/recrutamento/mantoRepositorio');
  const placar = await repo.placarPorRecrutador();
  assert.deepEqual(placar, [{ recrutador_id: recrutador.id, acertos: 1, erros: 0 }]);
});

test('manto: a mesma foto entregue duas vezes (simultânea ou depois) gera um só aviso', async () => {
  const provar = criarCanal(config.canais.provarManto, 'provar-manto');
  const guild = criarServidor({ canais: [provar], membros: [] });
  const foto = criarMensagem(provar, {}, { id: '910000000000000009', bot: false });
  foto.attachments = new Colecao([['a', { contentType: 'image/png' }]]);
  foto.createdAt = new Date();
  foto.client = guild.client;
  const antes = provar.enviadas.length;
  await Promise.all([painelManto.aoMensagem(foto), painelManto.aoMensagem(foto)]);
  await painelManto.aoMensagem(foto);
  assert.equal(provar.enviadas.length - antes, 1);
});

test('manto: mensagem sem imagem ou fora do provar-manto é ignorada', async () => {
  const outro = criarCanal('123', 'geral');
  const msg = criarMensagem(outro, {}, { id: 'U', bot: false });
  msg.attachments = new Colecao([['a', { contentType: 'image/png' }]]);
  assert.equal(await painelManto.aoMensagem(msg), false);
  assert.equal(outro.enviadas.length, 0);
});
