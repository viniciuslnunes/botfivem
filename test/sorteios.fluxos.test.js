// Sorteio de ponta a ponta: handlers REAIS, Postgres em memória e Discord falso.
// A lista de jogadores (registro diário) é substituída por uma lista fixa; o
// resto (permissão, banco, mensagens, DMs, histórico) é o de produção.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_SSL = 'off';
const { instalarBanco } = require('../tools/banco-em-memoria');
const { criarMembro, criarServidor, criarInteracao, criarCanal } = require('../tools/discord-falso');
const { PermissionFlagsBits } = require('discord.js');

let banco;
let despachar;
let config;
let comando;
let guild;
let gestor;
let socio;
let canalSorteios;
let canalHistorico;

// 1234 aparece duas vezes: é o mesmo jogador (distintos = 4)
const MIN = 60 * 1000;
const REGISTRO = [
  { id: '1234', nome: 'Beltrano', ms: 60 * MIN }, { id: '1111', nome: 'Ana', ms: 90 * MIN }, { id: '2222', nome: 'Carlos', ms: 20 * MIN },
  { id: '3333', nome: 'Diego', ms: 45 * MIN }, { id: '1234', nome: 'Beltrano', ms: 10 * MIN },
];

test.before(async () => {
  banco = await instalarBanco();
  config = require('../config/index.js');
  const plataforma = require('../plataforma');
  plataforma.carregarModulos({ commands: null });
  ({ despacharInteracao: despachar } = require('../utils/modulos'));
  comando = require('../commands/sorteio');
  require('../utils/logsJogo/relatorios').montarDadosPresenca = async () => ({ entradas: REGISTRO });

  gestor = criarMembro('900000000000000010', { nome: 'Presidente', cargos: [config.cargos.presidente], permissoes: [PermissionFlagsBits.Administrator] });
  socio = criarMembro('900000000000000011', { nome: 'Beltrano', apelido: 'S GDF | Beltrano - 1234', cargos: [config.cargos.socio] });
  guild = criarServidor({ canais: [criarCanal('REG', 'registros')], membros: [gestor, socio] });
});
test.after(async () => { await banco.pglite.close(); });

const clicar = (customId, membro = gestor, extra = {}) =>
  criarInteracao({ customId, membro, guild, canal: canalSorteios, ...extra });
const enviar = async i => { assert.equal(await despachar(i), true); return i; };
const modal = (customId, campos, membro = gestor) => enviar(clicar(customId, membro, { tipo: 'modal', campos }));
const sorteioId = async () => (await banco.q('SELECT id FROM sorteios ORDER BY id DESC LIMIT 1'))[0].id;
const premiosDoBanco = async () => banco.q('SELECT id, ordem, descricao, numero FROM sorteio_premios WHERE sorteio_id = $1 ORDER BY ordem', [await sorteioId()]);

test('estrutura: cria os dois canais e o painel com o botão de novo sorteio', async () => {
  const i = criarInteracao({ customId: 'x', membro: gestor, guild });
  i.options = { getSubcommand: () => 'estrutura' };
  await comando.execute(i);
  canalSorteios = guild.channels.cache.find(c => c.name === '🎁・sorteios');
  canalHistorico = guild.channels.cache.find(c => c.name === '📜・historico-sorteios');
  assert.ok(canalSorteios && canalHistorico);
  assert.equal(canalSorteios.enviadas.length, 1);
  assert.equal(canalSorteios.enviadas[0].components[0].components[0].data.custom_id, 'sorteio:novo');
});

test('criar: só a gestão; sócio comum é barrado no botão e no modal', async () => {
  const i = await enviar(clicar('sorteio:novo', socio));
  assert.match(i.acao('reply')[0].content, /SÓ A PRESIDÊNCIA/);
  const m = await modal('sorteio:m_novo', { titulo: 'X', premios: 'A' }, socio);
  assert.match(m.acao('reply')[0].content, /SÓ A PRESIDÊNCIA/);
  assert.equal((await banco.q('SELECT count(*)::int AS n FROM sorteios'))[0].n, 0);

  const abre = await enviar(clicar('sorteio:novo', gestor));
  assert.equal(abre.registros[0][0], 'showModal');
});

test('criar: mais prêmios que jogadores é recusado; válido numera, liga ao Discord e devolve o painel ao fim', async () => {
  const demais = await modal('sorteio:m_novo', { titulo: 'Pista', dia: '2026-09-20', premios: '1\n2\n3\n4\n5' });
  assert.match(demais.acao('editReply')[0].content, /5 PRÊMIOS PARA 4 NÚMEROS/);
  assert.equal((await banco.q('SELECT count(*)::int AS n FROM sorteios'))[0].n, 0);

  const ok = await modal('sorteio:m_novo', { titulo: 'Pista de sábado', dia: '2026-09-20', premios: '- Soco inglês\n- Moto\n- 100k' });
  assert.match(ok.acao('editReply')[0].content, /CRIADO/);
  const [s] = await banco.q('SELECT * FROM sorteios');
  assert.equal(s.total_numeros, 4);
  const lista = await banco.q('SELECT numero, id_jogo, discord_id FROM sorteio_participantes ORDER BY numero');
  assert.deepEqual(lista.map(p => p.id_jogo), ['1111', '1234', '2222', '3333']); // Ana, Beltrano, Carlos, Diego
  assert.equal(lista[1].discord_id, socio.id); // apelido "S GDF | Beltrano - 1234" liga ao Discord
  assert.equal(lista[0].discord_id, null);

  const [painelAntigo, vivo, painelNovo] = canalSorteios.enviadas;
  assert.ok(painelAntigo.apagada);
  assert.match(vivo.embeds[0].title, /SORTEIO #\d+ — Pista de sábado/);
  assert.equal(painelNovo.components[0].components[0].data.custom_id, 'sorteio:novo');
});

test('sortear próximo: só a gestão; sorteia um prêmio e avisa no canal', async () => {
  const id = await sorteioId();
  const barrado = await enviar(clicar(`sorteio:proximo:${id}`, socio));
  assert.match(barrado.acao('reply')[0].content, /SÓ A PRESIDÊNCIA/);
  assert.equal((await premiosDoBanco()).filter(p => p.numero != null).length, 0);

  const antes = canalSorteios.enviadas.length;
  await enviar(clicar(`sorteio:proximo:${id}`));
  const [p1] = await premiosDoBanco();
  assert.ok(p1.numero >= 1 && p1.numero <= 4);
  assert.match(canalSorteios.enviadas[antes].content, /Soco inglês/);

  // Fixa o Nº 2 (Beltrano, com Discord ligado) como ganhador do 1º prêmio para provar a DM adiante
  await banco.q('UPDATE sorteio_premios SET numero = 2 WHERE id = $1', [p1.id]);
  await banco.q('UPDATE sorteio_sorteadas SET numero = 2 WHERE premio_id = $1', [p1.id]); // a trilha acompanha
});

test('editar prêmio: botão → select → modal de 1 campo; sorteado não muda nem sai', async () => {
  const id = await sorteioId();
  const [p1, p2, p3] = await premiosDoBanco();
  const sel = await enviar(clicar(`sorteio:premio_edit:${id}`));
  assert.deepEqual(sel.acao('reply')[0].components[0].components[0].options.map(o => o.data.value), [String(p2.id), String(p3.id)]);

  const abre = await enviar(clicar(`sorteio:sel_edit:${id}`, gestor, { tipo: 'select', valores: [String(p2.id)] }));
  assert.equal(abre.registros[0][0], 'showModal');
  assert.equal(abre.registros[0][1].data.custom_id, `sorteio:m_edit:${id}:${p2.id}`);
  assert.equal(abre.registros[0][1].components.length, 1);

  await modal(`sorteio:m_edit:${id}:${p2.id}`, { descricao: 'Moto de trilha' });
  assert.equal((await premiosDoBanco())[1].descricao, 'Moto de trilha');

  const jaSorteado = await modal(`sorteio:m_edit:${id}:${p1.id}`, { descricao: 'Trocado' });
  assert.match(jaSorteado.acao('reply')[0].content, /JÁ FOI SORTEADO/);
  assert.equal((await premiosDoBanco())[0].descricao, 'Soco inglês');
  const jaSaiu = await enviar(clicar(`sorteio:sel_del:${id}`, gestor, { tipo: 'select', valores: [String(p1.id)] }));
  assert.match(jaSaiu.acao('reply')[0].content, /JÁ FOI SORTEADO/);
});

test('adicionar prêmios respeita o total de números; remover só pendente', async () => {
  const id = await sorteioId();
  const cheio = await modal(`sorteio:m_add:${id}`, { premios: 'A\nB' });
  assert.match(cheio.acao('reply')[0].content, /NO MÁXIMO 4 PRÊMIOS/);

  const um = await modal(`sorteio:m_add:${id}`, { premios: 'Colete' });
  assert.match(um.acao('reply')[0].content, /1 PRÊMIO/);
  const colete = (await premiosDoBanco()).find(p => p.descricao === 'Colete');
  await enviar(clicar(`sorteio:sel_del:${id}`, gestor, { tipo: 'select', valores: [String(colete.id)] }));
  assert.equal((await premiosDoBanco()).length, 3);
});

test('depois do 1º sorteio a lista congela; concluir exige todos os prêmios sorteados', async () => {
  const id = await sorteioId();
  const bloq = await enviar(clicar(`sorteio:atualizar:${id}`));
  assert.match(bloq.acao('editReply')[0].content, /A LISTA NÃO MUDA MAIS/);
  const cedo = await enviar(clicar(`sorteio:concluir:${id}`));
  assert.match(cedo.acao('editReply')[0].content, /AINDA HÁ 2 PRÊMIO/);
  assert.equal((await banco.q('SELECT status FROM sorteios WHERE id = $1', [id]))[0].status, 'ABERTO');
});

test('sortear todos: os prêmios restantes saem com números distintos entre si e do já sorteado', async () => {
  const id = await sorteioId();
  await enviar(clicar(`sorteio:todos:${id}`));
  const numeros = (await premiosDoBanco()).map(p => p.numero);
  assert.equal(numeros[0], 2);
  assert.ok(numeros.every(n => n != null && n >= 1 && n <= 4));
  assert.equal(new Set(numeros).size, 3);

  // Fixa os ganhadores (Beltrano Nº2, Carlos Nº3, Ana Nº1) para os testes de "ganhadores recentes" adiante
  const [p1, p2, p3] = await premiosDoBanco();
  await banco.q('UPDATE sorteio_premios SET numero = NULL WHERE id IN ($1, $2, $3)', [p1.id, p2.id, p3.id]);
  for (const [p, n] of [[p1, 2], [p2, 3], [p3, 1]]) await banco.q('UPDATE sorteio_premios SET numero = $2 WHERE id = $1', [p.id, n]);

  const extra = await enviar(clicar(`sorteio:proximo:${id}`));
  assert.match(extra.acao('followUp')[0].content, /NÃO HÁ PRÊMIO PENDENTE/);
  assert.equal((await premiosDoBanco()).length, 3);
});

test('concluir: anuncia, avisa por DM quem tem Discord ligado, grava no histórico e tira do canal vivo', async () => {
  const id = await sorteioId();
  const vivo = canalSorteios.enviadas.find(m => m.embeds[0]?.title?.includes(`SORTEIO #${id}`));
  const i = await enviar(clicar(`sorteio:concluir:${id}`));
  const resposta = i.acao('editReply')[0].content;
  assert.match(resposta, /CONCLUÍDO/);
  assert.match(resposta, /1 enviada\(s\)/);
  assert.match(resposta, /Registrado no histórico/);
  assert.equal((await banco.q('SELECT status FROM sorteios WHERE id = $1', [id]))[0].status, 'CONCLUIDO');
  assert.ok(vivo.apagada);

  assert.match(canalSorteios.enviadas.at(-1).content, /RESULTADO DO SORTEIO/);
  assert.equal(canalHistorico.enviadas.length, 1);
  assert.match(canalHistorico.enviadas[0].embeds[0].title, /📜 SORTEIO/);
  assert.equal(canalHistorico.enviadas[0].components[0].components[0].data.custom_id, `sorteio:entrega:${id}`);

  assert.equal(socio.dms.length, 1);
  assert.match(socio.dms[0].content, /Você ganhou.*Soco inglês/);
  const notificados = await banco.q('SELECT descricao FROM sorteio_premios WHERE notificado');
  assert.deepEqual(notificados.map(p => p.descricao), ['Soco inglês']);

  // encerrado: não sorteia nem edita mais
  const dnv = await enviar(clicar(`sorteio:proximo:${id}`));
  assert.match(dnv.acao('followUp')[0].content, /JÁ FOI ENCERRADO/);
  const add = await modal(`sorteio:m_add:${id}`, { premios: 'Tarde demais' });
  assert.match(add.acao('reply')[0].content, /JÁ FOI ENCERRADO/);
});

test('novo sorteio depois do histórico; modo só números 1..N; cancelar pede confirmação', async () => {
  const ok = await modal('sorteio:m_novo', { titulo: 'Rodada relâmpago', numeros: '15', premios: 'A\nB\nC' });
  assert.match(ok.acao('editReply')[0].content, /15 NÚMEROS/);
  const id = await sorteioId();
  assert.equal((await banco.q('SELECT count(*)::int AS n FROM sorteio_participantes WHERE sorteio_id = $1', [id]))[0].n, 0);

  await enviar(clicar(`sorteio:todos:${id}`));
  const n = (await premiosDoBanco()).map(p => p.numero);
  assert.equal(new Set(n).size, 3);
  assert.ok(n.every(x => x >= 1 && x <= 15));

  const pede = await enviar(clicar(`sorteio:cancelar:${id}`));
  assert.match(pede.acao('reply')[0].content, /CANCELAR O SORTEIO/);
  assert.equal((await banco.q('SELECT status FROM sorteios WHERE id = $1', [id]))[0].status, 'ABERTO');
  await enviar(clicar(`sorteio:cancelar_ok:${id}`));
  assert.equal((await banco.q('SELECT status FROM sorteios WHERE id = $1', [id]))[0].status, 'CANCELADO');
});

test('lista de participantes: qualquer sócio vê (ephemeral), com paginação própria', async () => {
  const [{ id }] = await banco.q("SELECT id FROM sorteios WHERE origem = 'REGISTRO'");
  const v = await enviar(clicar(`sorteio:lista:${id}`, socio));
  const embed = v.acao('reply')[0].embeds[0];
  assert.match(embed.description, /\*\*1\.\*\* \*\*Ana\*\* `1111`/);
  assert.equal(v.acao('reply')[0].flags, 64);
});

// ── Inteligência: elegibilidade, ressorteio, auditoria, entrega, lembrete ───
let idFiltro;
const participantesDe = async id => (await banco.q('SELECT id_jogo FROM sorteio_participantes WHERE sorteio_id = $1 ORDER BY numero', [id])).map(p => p.id_jogo);

test('elegibilidade: mínimo de minutos tira quem jogou pouco ANTES de numerar e mostra na mensagem', async () => {
  const r = await modal('sorteio:m_novo', { titulo: 'Só quem colou de verdade', dia: '2026-09-20', minutos: '30', premios: 'Colete' });
  assert.match(r.acao('editReply')[0].content, /3 NÚMEROS.*1 FORA POR TEMPO MÍNIMO/);
  idFiltro = await sorteioId();
  assert.deepEqual(await participantesDe(idFiltro), ['1111', '1234', '3333']); // Carlos (20 min) fora; 1234 soma 60 min
  const s = (await banco.q('SELECT * FROM sorteios WHERE id = $1', [idFiltro]))[0];
  assert.equal(s.min_minutos, 30);
  assert.equal(s.excluidos_minimo, 1);
  assert.match(s.lista_hash, /^[0-9a-f]{64}$/);
  const vivo = canalSorteios.enviadas.find(m => m.embeds[0]?.title?.includes(`SORTEIO #${idFiltro}`));
  assert.match(vivo.embeds[0].description, /mínimo de \*\*30 min\*\* online/);
  assert.match(vivo.embeds[0].description, /1 abaixo do mínimo/);

  const ruim = await modal('sorteio:m_novo', { titulo: 'X', dia: '2026-09-20', minutos: '900', premios: 'A' });
  assert.match(ruim.acao('editReply')[0].content, /NÃO HÁ JOGADORES ELEGÍVEIS.*4 ficaram abaixo de 900 min/);
});

test('elegibilidade: EXCLUIR RECENTES tira quem ganhou há pouco (Ana e Beltrano no sorteio 1) e libera de volta; o selo muda', async () => {
  const antes = (await banco.q('SELECT lista_hash FROM sorteios WHERE id = $1', [idFiltro]))[0].lista_hash;
  const liga = await enviar(clicar(`sorteio:recentes:${idFiltro}`));
  assert.match(liga.acao('editReply')[0].content, /FICARAM DE FORA \(2\)/);
  assert.deepEqual(await participantesDe(idFiltro), ['3333']); // Carlos já estava fora pelo mínimo
  const s = (await banco.q('SELECT * FROM sorteios WHERE id = $1', [idFiltro]))[0];
  assert.equal(s.excluir_dias, 30);
  assert.equal(s.total_numeros, 1);
  assert.equal(s.excluidos_recentes, 2);
  assert.notEqual(s.lista_hash, antes);

  const desliga = await enviar(clicar(`sorteio:recentes:${idFiltro}`));
  assert.match(desliga.acao('editReply')[0].content, /VOLTARAM/);
  assert.deepEqual(await participantesDe(idFiltro), ['1111', '1234', '3333']);
  assert.equal((await banco.q('SELECT excluir_dias FROM sorteios WHERE id = $1', [idFiltro]))[0].excluir_dias, null);

  const socioBarrado = await enviar(clicar(`sorteio:recentes:${idFiltro}`, socio));
  assert.match(socioBarrado.acao('reply')[0].content, /SÓ A PRESIDÊNCIA/);
});

test('ressorteio: ganhador ausente troca o número, o antigo fica queimado e a auditoria mostra tudo', async () => {
  const id = idFiltro;
  const semSorteio = await enviar(clicar(`sorteio:ressortear:${id}`));
  assert.match(semSorteio.acao('reply')[0].content, /NÃO HÁ PRÊMIO SORTEADO/);

  await enviar(clicar(`sorteio:proximo:${id}`));
  const [premio] = await premiosDoBanco();
  const primeiro = premio.numero;

  const sel = await enviar(clicar(`sorteio:ressortear:${id}`));
  assert.match(sel.acao('reply')[0].components[0].components[0].options[0].data.label, /Colete → Nº \d/);

  const re = await enviar(clicar(`sorteio:sel_re:${id}`, gestor, { tipo: 'select', valores: [String(premio.id)] }));
  assert.match(re.acao('update')[0].content, /PRÊMIO RESSORTEADO/);
  const [depois] = await premiosDoBanco();
  assert.notEqual(depois.numero, primeiro);
  assert.match(canalSorteios.enviadas.at(-1).content, /RESSORTEIO[\s\S]*saiu do prêmio/);

  const trilha = await banco.q('SELECT tipo, numero FROM sorteio_sorteadas WHERE sorteio_id = $1 ORDER BY id', [id]);
  assert.deepEqual(trilha.map(t => t.tipo), ['SORTEIO', 'RESSORTEIO']);
  assert.equal(new Set(trilha.map(t => t.numero)).size, 2);

  // qualquer sócio confere a auditoria
  const aud = await enviar(clicar(`sorteio:auditoria:${id}`, socio));
  const texto = aud.acao('reply')[0].embeds[0].description;
  assert.match(texto, /Selo da lista \(SHA-256\)/);
  assert.match(texto, /ressorteio/);
  assert.match(texto, /restavam \d+ número/);

  // 3 números no globo: o 3º ressorteio usa o último; o 4º já não tem número e nada muda
  await enviar(clicar(`sorteio:sel_re:${id}`, gestor, { tipo: 'select', valores: [String(premio.id)] }));
  const sem = await enviar(clicar(`sorteio:sel_re:${id}`, gestor, { tipo: 'select', valores: [String(premio.id)] }));
  assert.match(sem.acao('update')[0].content, /ACABARAM OS NÚMEROS/);
  const numeros = (await banco.q('SELECT numero FROM sorteio_sorteadas WHERE sorteio_id = $1', [id])).map(t => t.numero);
  assert.equal(new Set(numeros).size, 3);
});

test('entrega: concluir → botão no histórico → select → registrado; some o botão; lembrete só enquanto houver pendência', async () => {
  const id = idFiltro;
  const { lembrarEntrega } = require('../utils/sorteios/tarefas');
  await enviar(clicar(`sorteio:concluir:${id}`));
  const [s] = await banco.q('SELECT historico_message_id FROM sorteios WHERE id = $1', [id]);
  const registro = canalHistorico.historico.find(m => m.id === s.historico_message_id);
  assert.match(registro.embeds[0].description, /a entregar/);
  assert.equal(registro.components[0].components[0].data.custom_id, `sorteio:entrega:${id}`);
  assert.equal((await banco.q("SELECT count(*)::int AS n FROM tarefas_agendadas WHERE tipo = 'sorteio_lembrar_entrega'"))[0].n >= 2, true);

  await lembrarEntrega(guild.client, { sorteioId: id });
  assert.match(canalSorteios.enviadas.at(-1).content, /1\*\* prêmio\(s\) por entregar/);

  const barrado = await enviar(clicar(`sorteio:entrega:${id}`, socio));
  assert.match(barrado.acao('reply')[0].content, /SÓ A PRESIDÊNCIA/);
  const sel = await enviar(clicar(`sorteio:entrega:${id}`));
  const [premio] = await premiosDoBanco();
  assert.equal(sel.acao('reply')[0].components[0].components[0].options[0].data.value, String(premio.id));

  const ok = await enviar(clicar(`sorteio:sel_ent:${id}`, gestor, { tipo: 'select', valores: [String(premio.id)] }));
  assert.match(ok.acao('update')[0].content, /ENTREGA REGISTRADA/);
  assert.match(registro.embeds[0].description, /entregue por <@900000000000000010>/);
  assert.deepEqual(registro.components, []);
  assert.match(registro.embeds[0].footer.text, /todos os prêmios entregues/);

  const dnv = await enviar(clicar(`sorteio:sel_ent:${id}`, gestor, { tipo: 'select', valores: [String(premio.id)] }));
  assert.match(dnv.acao('update')[0].content, /JÁ FOI ENTREGUE/);

  const antes = canalSorteios.enviadas.length;
  await lembrarEntrega(guild.client, { sorteioId: id }); // nada pendente: silêncio
  assert.equal(canalSorteios.enviadas.length, antes);
});

test('mensagem viva apagada no canal é republicada na próxima ação', async () => {
  await modal('sorteio:m_novo', { titulo: 'Relâmpago 2', numeros: '5', premios: 'A' });
  const id = await sorteioId();
  const viva = canalSorteios.enviadas.find(m => m.embeds[0]?.title?.includes(`SORTEIO #${id}`));
  canalSorteios.historico = canalSorteios.historico.filter(m => m !== viva); // alguém apagou
  await enviar(clicar(`sorteio:proximo:${id}`));
  const nova = canalSorteios.enviadas.filter(m => m.embeds[0]?.title?.includes(`SORTEIO #${id}`) && m !== viva);
  assert.equal(nova.length, 1);
  assert.match(nova[0].embeds[0].footer.text, /1\/1 sorteados/);
  const [g] = await banco.q('SELECT message_id FROM sorteios WHERE id = $1', [id]);
  assert.equal(g.message_id, nova[0].id);
  // e o botão de novo sorteio continua por último
  assert.equal(canalSorteios.historico[0].components[0].components[0].data.custom_id, 'sorteio:novo');
});

test('/sorteio ganhos: cada um vê os seus; a gestão vê os de outra pessoa; sócio não vê os de outro', async () => {
  const consulta = async (membro, alvo) => {
    const i = criarInteracao({ customId: 'x', membro, guild });
    i.options = { getSubcommand: () => 'ganhos', getUser: () => alvo?.user ?? null };
    await comando.execute(i);
    return i;
  };
  const meus = await consulta(socio, null);
  assert.match(meus.acao('reply')[0].embeds[0].description, /Soco inglês\*\* — sorteio #\d+ Pista de sábado/);
  assert.match(meus.acao('reply')[0].embeds[0].description, /a entregar/);
  const gestao = await consulta(gestor, socio);
  assert.match(gestao.acao('reply')[0].embeds[0].description, /Soco inglês/);
  const outro = await consulta(socio, gestor);
  assert.match(outro.acao('reply')[0].content, /SÓ A GESTÃO/);
});
