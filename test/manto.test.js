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
  assert.deepEqual(semRecrutador, { acertos: 0, erros: 1, recuperados: 0 });
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
  foto.attachments = new Colecao([['a', { contentType: 'image/png', url: 'http://x/manto.png', name: 'manto.png' }]]);
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

  const dms = [];
  guild.client.users = { fetch: async id => ({ send: async payload => dms.push([id, payload]) }) };

  // ERRADO: só abre o select de motivos, ainda não grava nada
  const errado = criarInteracao({ customId: `mantoaval:errado:${foto.id}`, membro: lider, guild, canal: provar, mensagem: aviso });
  await despachar(errado);
  const seletor = errado.acao('reply')[0];
  assert.match(seletor.content, /POR QUE O MANTO ESTÁ ERRADO/);
  assert.equal(seletor.components[0].components[0].data.custom_id, `mantoaval:motivo:${foto.id}:${aviso.id}`);
  assert.equal((await banco.q('SELECT count(*)::int AS n FROM mantos_avaliados WHERE resultado IS NOT NULL'))[0].n, 0, 'sem motivo não há erro gravado');

  // motivo escolhido: grava ERRADO + motivo, abre o caso no canal do motivo
  const motivo = criarInteracao({ customId: `mantoaval:motivo:${foto.id}:${aviso.id}`, membro: lider, guild, canal: provar, mensagem: aviso, valores: ['foto_escura'] });
  await despachar(motivo);
  assert.match(motivo.acao('update')[0].content, /ERRADO.*Caso aberto em/s);
  assert.match(aviso.content, /MANTO ERRADO.*Foto escura demais/);
  assert.match(motivo.acao('update')[0].content, /Candidato avisado por DM/);
  assert.equal(dms[0][0], candidato.id);
  assert.match(dms[0][1].embeds[0].description, /Foto escura demais/);
  assert.equal(aviso.components.length, 1, 'aviso mantém os botões pra corrigir por 10 min');
  const [tarefa] = await banco.q("SELECT payload, executar_em > now() + interval '9 minutes' AS em_10min FROM tarefas_agendadas WHERE tipo = 'manto_remover_botoes'");
  assert.ok(tarefa?.em_10min, 'errado agenda a remoção dos botões para daqui a ~10 min');
  assert.equal(tarefa.payload.mensagemId, aviso.id);

  const canalCaso = [...guild.channels.cache.values()].find(c => c.name === '🧥・manto-foto-escura');
  assert.ok(canalCaso, 'canal do motivo criado sob demanda');
  const card = canalCaso.enviadas[0];
  const camposCard = Object.fromEntries(card.embeds[0].fields.map(c => [c.name, c.value]));
  assert.match(camposCard['RECRUTADOR DA FICHA'], new RegExp(recrutador.id));
  assert.match(camposCard['AVALIADO POR'], new RegExp(lider.id));
  assert.match(camposCard.STATUS, /ABERTO/);
  assert.equal(card.files[0].name, 'manto.png', 'foto reenviada no card');
  const [linha] = await banco.q('SELECT motivo, resultado, caso_canal_id FROM mantos_avaliados WHERE message_id = $1', [foto.id]);
  assert.deepEqual({ ...linha }, { motivo: 'foto_escura', resultado: 'ERRADO', caso_canal_id: canalCaso.id });

  // segundo caso do mesmo motivo reaproveita o canal
  const outra = criarMensagem(provar, {}, { id: candidato.id, bot: false });
  outra.attachments = new Colecao([['a', { contentType: 'image/png', url: 'http://x/y.png', name: 'y.png' }]]);
  outra.createdAt = new Date();
  outra.client = guild.client;
  provar.historico.unshift(outra);
  await painelManto.aoMensagem(outra);
  const aviso2 = provar.enviadas.at(-1);
  await despachar(criarInteracao({ customId: `mantoaval:motivo:${outra.id}:${aviso2.id}`, membro: lider, guild, canal: provar, mensagem: aviso2, valores: ['foto_escura'] }));
  assert.equal(canalCaso.enviadas.length, 2);
  assert.equal([...guild.channels.cache.values()].filter(c => c.name === '🧥・manto-foto-escura').length, 1);

  // sem permissão não resolve; liderança resolve uma vez só
  const resolverSem = criarInteracao({ customId: `mantoaval:resolver:${foto.id}`, membro: comum, guild, canal: canalCaso, mensagem: card });
  await despachar(resolverSem);
  assert.match(resolverSem.acao('reply')[0].content, /APENAS A LIDERANÇA/);
  const resolver = criarInteracao({ customId: `mantoaval:resolver:${foto.id}`, membro: lider, guild, canal: canalCaso, mensagem: card });
  await despachar(resolver);
  const cardResolvido = resolver.acao('update')[0];
  assert.deepEqual(cardResolvido.components, []);
  assert.match(cardResolvido.embeds[0].data.fields.find(c => c.name === 'STATUS').value, /RESOLVIDO/);
  const dupla = criarInteracao({ customId: `mantoaval:resolver:${foto.id}`, membro: lider, guild, canal: canalCaso, mensagem: card });
  await despachar(dupla);
  assert.match(dupla.acao('reply')[0].content, /JÁ FOI RESOLVIDO/);

  // reavaliar a segunda foto como CORRETO: card do caso é fechado como REVISTO
  const certo = criarInteracao({ customId: `mantoaval:certo:${outra.id}`, membro: lider, guild, canal: provar, mensagem: aviso2 });
  await despachar(certo);
  assert.match(certo.acao('update')[0].content, /MANTO CORRETO/);
  assert.deepEqual(certo.acao('update')[0].components, [], 'validado: botões somem');
  assert.match(canalCaso.enviadas[1].embeds[0].data.fields.find(c => c.name === 'STATUS').value, /REVISTO/);
  assert.deepEqual(canalCaso.enviadas[1].components, []);

  const repo = require('../utils/recrutamento/mantoRepositorio');
  const placar = await repo.placarPorRecrutador();
  assert.deepEqual(placar, [{ recrutador_id: recrutador.id, acertos: 1, erros: 0, recuperados: 1 }], 'o erro da 1ª foto foi recuperado pela 2ª, correta');
});

test('manto: ficha REPROVADA não conta erro contra o recrutador que reprovou', async () => {
  const cand = criarMembro('910000000000000021', { nome: 'Cand2' });
  const rec = criarMembro('910000000000000022', { nome: 'RecB', cargos: [config.cargos.recrutador] });
  const lider = criarMembro('910000000000000023', { nome: 'Lider2', cargos: [config.cargos.diretoria] });
  const provar = criarCanal(config.canais.provarManto, 'provar-manto');
  const guild = criarServidor({ canais: [provar], membros: [cand, rec, lider] });
  await banco.q(
    `INSERT INTO fichas_recrutamento (message_id, discord_id, status, decidido_por_id, criado_em)
     VALUES ('F2', $1, 'REPROVADO', $2, now() - interval '5 minutes')`, [cand.id, rec.id]
  );
  await banco.q("INSERT INTO mantos_avaliados (message_id, candidato_id, resultado, motivo, avaliado_por_id) VALUES ('M2', $1, 'ERRADO', 'ia', $2)", [cand.id, lider.id]);
  const placar = await require('../utils/recrutamento/mantoRepositorio').placarPorRecrutador();
  assert.equal(placar.find(l => l.recrutador_id === rec.id), undefined);
  assert.ok(guild);
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
