// Os fluxos do servidor dos Gaviões, de ponta a ponta: handlers REAIS, carregados
// pela plataforma exatamente como em produção (tenant gavioes, todos os módulos),
// contra Postgres em memória (com as migrações do bot) e um Discord falso.
// O que se prova aqui é o que o usuário do servidor vê e o que fica no banco.
//
// Nada toca Discord nem o banco real (tools/banco-em-memoria.js aborta se a
// substituição de utils/db.js não pegar).
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_SSL = 'off';
const { instalarBanco } = require('../tools/banco-em-memoria');
const { criarCanal, criarMembro, criarServidor, criarInteracao, criarMensagem } = require('../tools/discord-falso');

let banco;
let despachar;
let config;
let invalidarCacheBloqueios;

test.before(async () => {
  banco = await instalarBanco(); // ANTES de carregar qualquer módulo do bot
  config = require('../config/index.js');
  const plataforma = require('../plataforma');
  plataforma.carregarModulos({ commands: null }); // registra todos os handlers, como no start
  ({ despacharInteracao: despachar } = require('../utils/modulos'));
  ({ invalidarCacheBloqueios } = require('../utils/naoRecrutar'));
});

test.after(async () => {
  await banco.pglite.close();
});

// Silencia (e guarda) o console durante um fluxo: o código de produção tem logs
// de depuração; o que importa é conferir se algum ERRO inesperado apareceu.
async function comConsole(fn) {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const erros = [];
  console.log = () => {};
  console.warn = () => {};
  console.error = (...a) => erros.push(a.map(x => (x instanceof Error ? x.message : String(x))).join(' '));
  try { return { ...(await fn()), erros }; } finally { Object.assign(console, original); }
}

// Servidor com os canais dos Gaviões (IDs reais do tenant) e os membros pedidos.
function cenario({ membros = [] } = {}) {
  const c = config.canais;
  const canais = [
    criarCanal(c.recrutamento, 'recrutamento'), criarCanal(c.validarSetagem, 'validar-setagem'),
    criarCanal(c.provarManto, 'provar-manto'), criarCanal(c.telefoneSocio, 'telefone-socios'),
    criarCanal(c.historicoNaoRecrutar, 'historico-nao-recrutar'), criarCanal(c.topRecrutadores, 'top-recrutadores'),
    criarCanal(c.historicoAdv, 'historico-adv'), criarCanal(c.advPendentes, 'adv-pendentes'),
    criarCanal(c.logsTicket, 'logs-ticket'), criarCanal(c.mural, 'mural'),
    criarCanal(c.associadoEmAtencao, 'associado-em-atencao'), criarCanal(c.carteirinha, 'carteirinha'),
  ];
  const guild = criarServidor({ canais, membros });
  return { guild, canal: id => guild.channels.cache.get(id) };
}

const tabela = async (sql, params) => banco.q(sql, params);

// ── Recrutamento ─────────────────────────────────────────────────────────────
const FORM = { nome: 'Fulano de Tal', idade: '25', id_fivem: '1234', telefone: '11912345678', recrutador: 'Beltrano' };

async function enviarFormulario(guild, candidato, campos = FORM) {
  const i = criarInteracao({ customId: 'modal_recrutamento', membro: candidato, guild, canal: guild.channels.cache.get(config.canais.recrutamento), campos });
  const timers = [];
  const setTimeoutOriginal = global.setTimeout;
  global.setTimeout = (fn, ms) => { timers.push(ms); return { unref() {} }; }; // o aviso apaga sozinho em 5 min
  try {
    const r = await comConsole(async () => { assert.equal(await despachar(i), true); return {}; });
    return { i, timers, erros: r.erros };
  } finally {
    global.setTimeout = setTimeoutOriginal;
  }
}

test('recrutamento: candidato clica em SOLICITAR e recebe o formulário; sócio é barrado', async () => {
  const candidato = criarMembro('900000000000000001', { nome: 'Candidato' });
  const socio = criarMembro('900000000000000002', { nome: 'Socio', cargos: [config.cargos.socio] });
  const { guild } = cenario({ membros: [candidato, socio] });

  const abre = criarInteracao({ customId: 'abrir_recrutamento', membro: candidato, guild });
  await despachar(abre);
  const [, modal] = abre.registros[0];
  assert.equal(abre.registros[0][0], 'showModal');
  assert.equal(modal.data.custom_id, 'modal_recrutamento');

  const jaSocio = criarInteracao({ customId: 'abrir_recrutamento', membro: socio, guild });
  await despachar(jaSocio);
  assert.match(jaSocio.acao('reply')[0].content, /VOCÊ JÁ É SÓCIO DA TORCIDA/);
});

test('recrutamento: formulário inválido é recusado com a mensagem certa e nada é gravado', async () => {
  const candidato = criarMembro('900000000000000003', { nome: 'Candidato' });
  const { guild, canal } = cenario({ membros: [candidato] });

  for (const [campos, trecho] of [
    [{ ...FORM, id_fivem: 'abc' }, /CAMPO \*\*ID FIVEM\*\* DEVE CONTER APENAS NÚMEROS/],
    [{ ...FORM, idade: '123' }, /CAMPO \*\*IDADE\*\* DEVE CONTER APENAS NÚMEROS E TER NO MÁXIMO 2 DÍGITOS/],
    [{ ...FORM, telefone: '12345' }, /CAMPO \*\*TELEFONE\*\* DEVE CONTER APENAS NÚMEROS, COM 10 OU 11 DÍGITOS/],
  ]) {
    const { i } = await enviarFormulario(guild, candidato, campos);
    assert.match(i.acao('reply')[0].embeds[0].description, trecho);
  }
  assert.equal(canal(config.canais.validarSetagem).enviadas.length, 0);
  assert.deepEqual(candidato.registros, []);
  assert.equal((await tabela('SELECT count(*)::int AS n FROM fichas_recrutamento WHERE discord_id = $1', [candidato.id]))[0].n, 0);
});

test('recrutamento: formulário válido → ficha PENDENTE no banco, análise com botões, cargo PROVAR MANTO e remoção agendada', async () => {
  const candidato = criarMembro('900000000000000004', { nome: 'Candidato' });
  const { guild, canal } = cenario({ membros: [candidato] });

  const { i, timers, erros } = await enviarFormulario(guild, candidato);
  assert.deepEqual(erros, []);
  assert.match(i.acao('reply')[0].content, /SUA SOLICITAÇÃO FOI ENVIADA PARA ANÁLISE/);

  const [analise] = canal(config.canais.validarSetagem).enviadas;
  assert.equal(analise.embeds[0].title, '📋 NOVA SOLICITAÇÃO DE RECRUTAMENTO');
  const campo = n => analise.embeds[0].fields.find(f => f.name === n).value;
  assert.equal(campo('NOME'), 'Fulano de Tal');
  assert.equal(campo('ID FIVEM'), '1234');
  assert.equal(campo('ID | DISCORD'), `${candidato.id} | <@${candidato.id}>`);
  assert.deepEqual(analise.components[0].components.map(b => b.data.custom_id), ['aprovar_recrutamento', 'reprovar_recrutamento']);

  const [ficha] = await tabela('SELECT * FROM fichas_recrutamento WHERE message_id = $1', [analise.id]);
  assert.equal(ficha.status, 'PENDENTE');
  assert.equal(ficha.discord_id, candidato.id);
  assert.equal(ficha.id_fivem, '1234');
  assert.equal(ficha.telefone, '11912345678');
  assert.equal(ficha.idade, 25);

  assert.deepEqual(candidato.registros, [['add', config.cargos.provarManto]]);
  assert.match(canal(config.canais.provarManto).enviadas[0].content, /você tem 10 minutos para enviar o manto/);
  assert.deepEqual(timers, [5 * 60 * 1000]); // apaga o aviso em 5 min

  const [tarefa] = await tabela("SELECT tipo, payload FROM tarefas_agendadas WHERE tipo = 'remover_cargo'");
  assert.deepEqual(JSON.parse(typeof tarefa.payload === 'string' ? tarefa.payload : JSON.stringify(tarefa.payload)), { membroId: candidato.id, cargoId: config.cargos.provarManto });

  // já tem ficha pendente: não abre outro formulário
  const denovo = criarInteracao({ customId: 'abrir_recrutamento', membro: candidato, guild });
  await despachar(denovo);
  assert.equal(denovo.registros[0][0], 'reply');
});

async function candidatoComFichaPendente(idCandidato) {
  const candidato = criarMembro(idCandidato, { nome: 'Candidato', cargos: [config.cargos.visitante] });
  const recrutador = criarMembro('900000000000000099', { nome: 'Recrutador', cargos: [config.cargos.recrutador] });
  const cen = cenario({ membros: [candidato, recrutador] });
  await enviarFormulario(cen.guild, candidato);
  candidato.registros.length = 0;
  const analise = cen.canal(config.canais.validarSetagem).enviadas[0];
  return { ...cen, candidato, recrutador, analise };
}

test('recrutamento: APROVAR → sócio, cargos trocados, apelido no padrão, aprovação e ficha no banco, telefone divulgado, ranking atualizado', async () => {
  invalidarCacheBloqueios();
  const { guild, canal, candidato, recrutador, analise } = await candidatoComFichaPendente('900000000000000005');

  const i = criarInteracao({ customId: 'aprovar_recrutamento', membro: recrutador, guild, canal: canal(config.canais.validarSetagem), mensagem: analise });
  const { erros } = await comConsole(async () => { await despachar(i); return {}; });
  assert.deepEqual(erros, [], 'nenhum erro inesperado no fluxo de aprovação');

  // cargos e apelido
  assert.deepEqual(candidato.registros, [
    ['add', config.cargos.socio], ['remove', config.cargos.provarManto], ['remove', config.cargos.visitante], ['nick', 'S GDF | Fulano de Tal - 1234'],
  ]);
  // banco
  assert.deepEqual((await tabela('SELECT aprovador_id FROM aprovacoes_recrutamento')).map(r => r.aprovador_id), [recrutador.id]);
  const [ficha] = await tabela('SELECT status, decidido_por_id FROM fichas_recrutamento WHERE message_id = $1', [analise.id]);
  assert.deepEqual({ status: ficha.status, por: ficha.decidido_por_id }, { status: 'APROVADO', por: recrutador.id });
  // telefone divulgado
  assert.match(canal(config.canais.telefoneSocio).enviadas[0].content, /NOVO SÓCIO APROVADO: \*\*Fulano de Tal\*\* \(ID FIVEM 1234\)[\s\S]*TELEFONE: \*\*11912345678\*\*/);
  // mensagem de análise fechada com o status
  assert.deepEqual(analise.components[0].components.map(b => b.data.custom_id), [`recrut:desfazer:${analise.id}`]);
  assert.match(analise.embeds[0].fields.at(-1).value, new RegExp(`APROVADO POR <@${recrutador.id}>`));
  // ranking de recrutadores
  const top = canal(config.canais.topRecrutadores).enviadas[0];
  assert.match(top.embeds[0].description, new RegExp(`<@${recrutador.id}> — \\*\\*1 APROVAÇÕES\\*\\*`));

  // segundo clique (ou outro recrutador ao mesmo tempo): já analisada
  const segundo = criarInteracao({ customId: 'aprovar_recrutamento', membro: recrutador, guild, canal: canal(config.canais.validarSetagem), mensagem: analise });
  await despachar(segundo);
  assert.match(segundo.acao('reply')[0].content, /JÁ ESTÁ SENDO \(OU JÁ FOI\) ANALISADA/);
  assert.equal((await tabela('SELECT count(*)::int AS n FROM aprovacoes_recrutamento'))[0].n, 1);
});

test('recrutamento: ID na lista "não recrutar" NÃO é aprovado (sem cargo, sem banco, aviso no canal)', async () => {
  const { guild, canal, candidato, recrutador, analise } = await candidatoComFichaPendente('900000000000000006');
  // histórico do canal com o bloqueio do ID 1234 (formato que o próprio bot grava)
  const historico = canal(config.canais.historicoNaoRecrutar);
  historico.historico.unshift(criarMensagem(historico, { embeds: [{ title: 'ID Bloqueado', fields: [{ name: 'ID', value: '1234' }, { name: 'MOTIVO', value: 'Traição' }] }] }));
  invalidarCacheBloqueios();
  const antes = (await tabela('SELECT count(*)::int AS n FROM aprovacoes_recrutamento'))[0].n;

  const i = criarInteracao({ customId: 'aprovar_recrutamento', membro: recrutador, guild, canal: canal(config.canais.validarSetagem), mensagem: analise });
  await comConsole(async () => { await despachar(i); return {}; });
  invalidarCacheBloqueios();

  assert.match(canal(config.canais.validarSetagem).enviadas.at(-1).content, /O ID FiveM \*\*1234\*\* está bloqueado para recrutamento!/);
  assert.deepEqual(candidato.registros, []); // nada de cargo nem apelido
  assert.equal((await tabela('SELECT count(*)::int AS n FROM aprovacoes_recrutamento'))[0].n, antes);
  const [ficha] = await tabela('SELECT status FROM fichas_recrutamento WHERE message_id = $1', [analise.id]);
  assert.equal(ficha.status, 'PENDENTE');
});

test('recrutamento: REPROVAR abre o laudo (modal) da ficha certa', async () => {
  const { guild, canal, recrutador, analise } = await candidatoComFichaPendente('900000000000000007');
  const i = criarInteracao({ customId: 'reprovar_recrutamento', membro: recrutador, guild, canal: canal(config.canais.validarSetagem), mensagem: analise });
  await despachar(i);
  assert.equal(i.registros[0][0], 'showModal');
  assert.equal(i.registros[0][1].data.custom_id, `recrut:reprovar:${analise.id}`);
});

// ── Ticket ───────────────────────────────────────────────────────────────────
test('ticket: abrir → escolher categoria → canal privado criado com o embed e o botão de fechar', async () => {
  const usuario = criarMembro('900000000000000010', { nome: 'Maria Souza' });
  const { guild } = cenario({ membros: [usuario] });

  const abre = criarInteracao({ customId: 'abrir_ticket', membro: usuario, guild });
  await despachar(abre);
  const resposta = abre.acao('reply')[0];
  assert.match(resposta.content, /ABRIR TICKET/);
  const select = resposta.components[0].components[0];
  assert.equal(select.data.custom_id, 'select_categoria_ticket');
  assert.deepEqual(select.options.map(o => o.data.value), ['parceria', 'denuncia', 'denuncia_diretor', 'recrutamento']);

  const escolhe = criarInteracao({ customId: 'select_categoria_ticket', membro: usuario, guild, valores: ['parceria'] });
  await comConsole(async () => { await despachar(escolhe); return {}; });
  const canalTicket = [...guild.channels.cache.values()].find(c => c.name === 'ticket-mariasouza');
  assert.ok(canalTicket, 'canal do ticket criado com o nome do usuário');
  assert.equal(canalTicket.opcoes.parent, config.categorias.tickets);
  const [msg] = canalTicket.enviadas;
  assert.match(msg.embeds[0].data.title, /TICKET CRIADO — 🤝 PARCERIA/);
  assert.match(msg.embeds[0].data.description, /NOSSA EQUIPE DA GAVIÕES DA FIEL VAI TE ATENDER EM BREVE/);
  assert.equal(msg.components[0].components[0].data.custom_id, 'fechar_ticket');
  assert.match(escolhe.acao('editReply')[0].content, /TICKET CRIADO/);

  // segundo clique com ticket aberto: avisa e não cria outro
  const denovo = criarInteracao({ customId: 'abrir_ticket', membro: usuario, guild });
  await despachar(denovo);
  assert.match(denovo.acao('reply')[0].content, /VOCÊ JÁ TEM UM TICKET ABERTO/);
});

test('ticket: fechar → transcript HTML enviado ao canal de logs e canal apagado; fora de ticket não faz nada', async () => {
  const usuario = criarMembro('900000000000000011', { nome: 'Joao Silva' });
  const { guild, canal } = cenario({ membros: [usuario] });
  const escolhe = criarInteracao({ customId: 'select_categoria_ticket', membro: usuario, guild, valores: ['denuncia'] });
  await comConsole(async () => { await despachar(escolhe); return {}; });
  const ticket = [...guild.channels.cache.values()].find(c => c.name === 'ticket-joaosilva');
  ticket.historico.unshift(criarMensagem(ticket, { content: 'Preciso de ajuda com <b>isso</b>' }, { id: usuario.id, bot: false, username: 'Joao Silva' }));

  const fecha = criarInteracao({ customId: 'fechar_ticket', membro: usuario, guild, canal: ticket });
  const { erros } = await comConsole(async () => { await despachar(fecha); return {}; });
  assert.deepEqual(erros, []);
  const [log] = canal(config.canais.logsTicket).enviadas;
  assert.match(log.content, /TICKET FECHADO: \*\*ticket-joaosilva\*\*/);
  assert.equal(log.files[0].name, `transcript-${ticket.id}.html`);
  const html = log.files[0].attachment.toString('utf8');
  assert.match(html, /<title>Transcript — #ticket-joaosilva<\/title>/);
  assert.match(html, /Preciso de ajuda com &lt;b&gt;isso&lt;\/b&gt;/); // HTML do usuário escapado
  assert.equal(ticket.apagado, true);

  const geral = criarCanal('777', 'geral');
  const fora = criarInteracao({ customId: 'fechar_ticket', membro: usuario, guild, canal: geral });
  await despachar(fora);
  assert.deepEqual(fora.registros, []);
  assert.equal(geral.apagado, false);
});

// ── Carteirinha ──────────────────────────────────────────────────────────────
test('carteirinha: só sócio recebe; número sequencial gravado; a mesma pessoa recebe o mesmo número; imagem PNG anexada', async () => {
  const naoSocio = criarMembro('900000000000000020', { nome: 'Visitante' });
  const socioA = criarMembro('900000000000000021', { nome: 'Ana', cargos: [config.cargos.socio] });
  const socioB = criarMembro('900000000000000022', { nome: 'Bia', cargos: [config.cargos.socio] });
  const { guild } = cenario({ membros: [naoSocio, socioA, socioB] });
  const pedir = async m => {
    const i = criarInteracao({ customId: 'solicitar_carteirinha', membro: m, guild });
    const r = await comConsole(async () => { await despachar(i); return {}; });
    return { i, erros: r.erros };
  };

  const recusa = await pedir(naoSocio);
  assert.match(recusa.i.acao('editReply')[0].content, /CARTEIRINHA É EXCLUSIVA PARA SÓCIOS APROVADOS/);

  const a1 = await pedir(socioA);
  assert.deepEqual(a1.erros, []);
  const resp = a1.i.acao('editReply')[0];
  assert.match(resp.content, /CARTEIRINHA DE SÓCIO Nº \*\*0001\*\*/);
  assert.match(resp.content, /VIGENTE/);
  assert.equal(resp.files[0].name, 'carteirinha.png');
  assert.deepEqual([...resp.files[0].attachment.subarray(0, 4)], [0x89, 0x50, 0x4E, 0x47]); // assinatura PNG

  const a2 = await pedir(socioA);
  assert.match(a2.i.acao('editReply')[0].content, /Nº \*\*0001\*\*/); // não gera outro número
  const b = await pedir(socioB);
  assert.match(b.i.acao('editReply')[0].content, /Nº \*\*0002\*\*/);

  const linhas = await tabela('SELECT discord_id, numero_socio FROM socios ORDER BY numero_socio');
  assert.deepEqual(linhas.map(l => [l.discord_id, l.numero_socio]), [[socioA.id, 1], [socioB.id, 2]]);
});

// ── Advertência de sócio ─────────────────────────────────────────────────────
test('advertência: botão → select do membro → select do prazo → modal, com os customIds de sempre', async () => {
  const lider = criarMembro('900000000000000030', { nome: 'Lider', cargos: [config.cargos.diretoria] });
  const { guild } = cenario({ membros: [lider] });

  const b = criarInteracao({ customId: 'abrir_registrar_advertencia', membro: lider, guild });
  await despachar(b);
  assert.equal(b.acao('reply')[0].components[0].components[0].data.custom_id, 'select_membro_adv_registrar');

  const s1 = criarInteracao({ customId: 'select_membro_adv_registrar', membro: lider, guild, valores: ['900000000000000031'] });
  await despachar(s1);
  const prazo = s1.acao('reply')[0].components[0].components[0];
  assert.equal(prazo.data.custom_id, 'select_prazo_adv:900000000000000031');
  assert.deepEqual(prazo.options.map(o => o.data.value), ['test', '1', '2', '3']);

  const s2 = criarInteracao({ customId: 'select_prazo_adv:900000000000000031', membro: lider, guild, valores: ['2'] });
  await despachar(s2);
  assert.equal(s2.registros[0][1].data.custom_id, 'modal_registrar_advertencia:900000000000000031:2');
});

test('advertência: 1ª, 2ª e 3ª sobem o cargo e agendam o vencimento; a 4ª é recusada; remover desce um nível', async () => {
  const lider = criarMembro('900000000000000032', { nome: 'Lider', cargos: [config.cargos.diretoria] });
  const punido = criarMembro('900000000000000033', { nome: 'Punido', cargos: [config.cargos.socio] });
  const { guild, canal } = cenario({ membros: [lider, punido] });
  const [adv1, adv2, adv3] = config.cargos.adv;
  const registrar = async () => {
    const i = criarInteracao({ customId: `modal_registrar_advertencia:${punido.id}:1`, membro: lider, guild, campos: { motivo: 'Não escutou a call', punicao: '300 serviços', prova: '' } });
    const r = await comConsole(async () => { await despachar(i); return {}; });
    await new Promise(res => setTimeout(res, 20)); // deixa a checagem de restrição (sem await no código) terminar
    return { i, erros: r.erros };
  };
  const cargosAdv = () => config.cargos.adv.filter(id => punido.roles.cache.has(id));

  const r1 = await registrar();
  assert.deepEqual(cargosAdv(), [adv1]);
  assert.match(r1.i.acao('reply')[0].content, /1ª ADVERTÊNCIA\*\* REGISTRADA/);
  assert.equal(canal(config.canais.historicoAdv).enviadas[0].embeds[0].title, '❌ ADVERTÊNCIA 1ª REGISTRADA');

  await registrar();
  assert.deepEqual(cargosAdv(), [adv2]); // subiu: sai a 1ª, entra a 2ª
  await registrar();
  assert.deepEqual(cargosAdv(), [adv3]);

  const quarta = await registrar();
  assert.match(quarta.i.acao('reply')[0].content, /JÁ POSSUI A \*\*3ª ADVERTÊNCIA\*\* \(MÁXIMO ATINGIDO\)/);
  assert.deepEqual(cargosAdv(), [adv3]);

  const tarefas = await tabela("SELECT payload FROM tarefas_agendadas WHERE tipo = 'adv_vencimento' ORDER BY id");
  assert.equal(tarefas.length, 3);
  const numeros = tarefas.map(t => (typeof t.payload === 'string' ? JSON.parse(t.payload) : t.payload).numAdv);
  assert.deepEqual(numeros, [1, 2, 3]);

  const remover = criarInteracao({ customId: `modal_remover_advertencia:${punido.id}`, membro: lider, guild, campos: { motivo: 'Pagou', prova: '' } });
  await comConsole(async () => { await despachar(remover); return {}; });
  assert.deepEqual(cargosAdv(), [adv2]);
});

// ── Não recrutar (bloqueio de ID) ────────────────────────────────────────────
test('não recrutar: abrir modais, bloquear ID, validar (bloqueado × liberado) e recusar ID de sócio ativo', async () => {
  invalidarCacheBloqueios();
  const lider = criarMembro('900000000000000040', { nome: 'Lider', cargos: [config.cargos.diretoria] });
  const socio = criarMembro('900000000000000041', { nome: 'Socio Ativo', cargos: [config.cargos.socio], apelido: 'S GDF | Socio Ativo - 555' });
  const { guild, canal } = cenario({ membros: [lider, socio] });

  for (const [botao, modal] of [['abrir_bloquearid', 'modal_bloquearid'], ['abrir_desbloquearid', 'modal_desbloquearid'], ['abrir_validarid', 'modal_validarid']]) {
    const i = criarInteracao({ customId: botao, membro: lider, guild });
    await despachar(i);
    assert.equal(i.registros[0][1].data.custom_id, modal);
  }

  // ID de sócio ativo: recusa
  const recusa = criarInteracao({ customId: 'modal_bloquearid', membro: lider, guild, campos: { id: '555', motivo: 'teste', prova: '' } });
  await comConsole(async () => { await despachar(recusa); return {}; });
  assert.match(recusa.acao('editReply')[0].content, /É DE .*SÓCIO ATIVO. DESLIGUE/);
  assert.equal(canal(config.canais.historicoNaoRecrutar).enviadas.length, 0);

  // ID comum: bloqueia (embed no histórico)
  const bloqueia = criarInteracao({ customId: 'modal_bloquearid', membro: lider, guild, campos: { id: '9999', motivo: 'Traição', prova: 'link' } });
  const r = await comConsole(async () => { await despachar(bloqueia); return {}; });
  assert.deepEqual(r.erros, []);
  const [registro] = canal(config.canais.historicoNaoRecrutar).enviadas;
  assert.equal(registro.embeds[0].title, '❌ ID Bloqueado para Recrutamento');
  assert.equal(registro.embeds[0].fields.find(f => f.name === 'ID').value, '9999');

  // validar
  invalidarCacheBloqueios();
  const bloqueado = criarInteracao({ customId: 'modal_validarid', membro: lider, guild, campos: { id_fivem: '9999' } });
  await comConsole(async () => { await despachar(bloqueado); return {}; });
  assert.match(bloqueado.acao('editReply')[0].content, /ID FiveM \*\*9999\*\* está bloqueado/);
  const liberado = criarInteracao({ customId: 'modal_validarid', membro: lider, guild, campos: { id_fivem: '1111' } });
  await comConsole(async () => { await despachar(liberado); return {}; });
  assert.match(liberado.acao('editReply')[0].content, /ID FiveM \*\*1111\*\* está \*\*liberado\*\*/);
  invalidarCacheBloqueios();
});
