// Desfazer aprovação/reprovação de ficha (janela de 30 min): handlers REAIS contra Postgres em
// memória e Discord falso (mesmo esquema de test/fluxos.gavioes.test.js). Nada toca o banco real.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_SSL = 'off';
const { instalarBanco } = require('../tools/banco-em-memoria');
const { criarCanal, criarMembro, criarServidor, criarInteracao } = require('../tools/discord-falso');

let banco;
let despachar;
let config;
let regras;

test.before(async () => {
  banco = await instalarBanco(); // ANTES de carregar qualquer módulo do bot
  config = require('../config/index.js');
  require('../plataforma').carregarModulos({ commands: null });
  ({ despacharInteracao: despachar } = require('../utils/modulos'));
  regras = require('../utils/recrutamento/regras');
});

test.after(async () => {
  await banco.pglite.close();
});

async function comConsole(fn) {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const erros = [];
  console.log = () => {};
  console.warn = () => {};
  console.error = (...a) => erros.push(a.map(x => (x instanceof Error ? x.message : String(x))).join(' '));
  try { await fn(); } finally { Object.assign(console, original); }
  return erros;
}

const tabela = (sql, params) => banco.q(sql, params);
const FORM = { nome: 'Fulano de Tal', idade: '25', id_fivem: '1234', telefone: '11912345678', recrutador: 'Beltrano' };
let seq = 0;

// Candidato que já mandou o formulário (ficha PENDENTE na mensagem de análise) + um recrutador
async function cenarioComFicha() {
  const n = ++seq;
  const candidato = criarMembro(`91000000000000${String(n).padStart(4, '0')}`, { nome: 'Candidato', cargos: [config.cargos.visitante] });
  const recrutador = criarMembro(`92000000000000${String(n).padStart(4, '0')}`, { nome: 'Recrutador', cargos: [config.cargos.recrutador] });
  const c = config.canais;
  const canais = [c.recrutamento, c.validarSetagem, c.provarManto, c.telefoneSocio, c.historicoNaoRecrutar, c.topRecrutadores, c.carteirinha, c.mural]
    .map((id, i) => criarCanal(id, `canal-${i}`));
  const guild = criarServidor({ canais, membros: [candidato, recrutador] });
  const canal = id => guild.channels.cache.get(id);

  const form = criarInteracao({ customId: 'modal_recrutamento', membro: candidato, guild, canal: canal(c.recrutamento), campos: FORM, tipo: 'modal' });
  const setTimeoutOriginal = global.setTimeout;
  global.setTimeout = () => ({ unref() {} });
  try { await comConsole(async () => { await despachar(form); }); } finally { global.setTimeout = setTimeoutOriginal; }
  candidato.registros.length = 0;
  return { guild, canal, candidato, recrutador, analise: canal(c.validarSetagem).enviadas[0] };
}

const clicar = async (customId, membro, guild, analise, extra = {}) => {
  const i = criarInteracao({ customId, membro, guild, canal: analise.channel, mensagem: analise, ...extra });
  const erros = await comConsole(async () => { await despachar(i); });
  return { i, erros };
};
const botoes = msg => msg.components.flatMap(l => l.components.map(b => b.data.custom_id));
const statusDaFicha = async id => (await tabela('SELECT status FROM fichas_recrutamento WHERE message_id = $1', [id]))[0].status;
const contar = async (sql, params) => (await tabela(sql, params))[0].n;
// Contagens por ficha: os testes compartilham o mesmo banco em memória
const aprovacoes = id => contar('SELECT count(*)::int AS n FROM aprovacoes_recrutamento WHERE ficha_message_id = $1', [id]);
const sinais = (sinal, id) => contar('SELECT count(*)::int AS n FROM confianca_eventos WHERE sinal = $1 AND origem_id = $2', [sinal, id]);

test('desfazer aprovação: sócio sai, ficha volta a PENDENTE com APROVAR/REPROVAR, ranking, confiança e telefone desfeitos, volta ao PROVAR MANTO', async () => {
  const { guild, canal, candidato, recrutador, analise } = await cenarioComFicha();
  await clicar('aprovar_recrutamento', recrutador, guild, analise);
  assert.equal(await statusDaFicha(analise.id), 'APROVADO');
  assert.deepEqual(botoes(analise), [`recrut:desfazer:${analise.id}`]);
  assert.match(analise.content, /Dá para desfazer até/);
  assert.equal(await aprovacoes(analise.id), 1);
  assert.equal(await sinais('APROVACAO', analise.id), 1);
  const tel = canal(config.canais.telefoneSocio).enviadas[0];
  assert.ok(candidato.roles.cache.has(config.cargos.socio));
  candidato.registros.length = 0;

  const { i, erros } = await clicar(`recrut:desfazer:${analise.id}`, recrutador, guild, analise);
  assert.deepEqual(erros.filter(e => !/users|fetch/i.test(e)), []);
  assert.match(i.acao('editReply')[0].content, /APROVAÇÃO DESFEITA/);

  assert.equal(candidato.roles.cache.has(config.cargos.socio), false);
  assert.ok(candidato.roles.cache.has(config.cargos.provarManto));
  assert.ok(candidato.roles.cache.has(config.cargos.visitante));
  assert.equal(await statusDaFicha(analise.id), 'PENDENTE');
  const [ficha] = await tabela('SELECT decidido_por_id, decidido_em, desfeita_por_id, desfeitas FROM fichas_recrutamento WHERE message_id = $1', [analise.id]);
  assert.deepEqual({ ...ficha, decidido_em: ficha.decidido_em }, { decidido_por_id: null, decidido_em: null, desfeita_por_id: recrutador.id, desfeitas: 1 });
  assert.equal(await aprovacoes(analise.id), 0);
  assert.equal(await sinais('APROVACAO', analise.id), 0);
  assert.equal(tel.apagada, true);
  assert.deepEqual(botoes(analise), ['aprovar_recrutamento', 'reprovar_recrutamento']);
  assert.equal(analise.embeds[0].fields.some(f => /status/i.test(f.name)), false);
  assert.equal(analise.embeds[0].fields.length, 6);
  const tarefas = await tabela("SELECT payload FROM tarefas_agendadas WHERE tipo = 'remover_cargo'");
  assert.ok(tarefas.length >= 2, 'remoção do PROVAR MANTO agendada de novo');
  assert.match(canal(config.canais.provarManto).enviadas.at(-1).content, /voltou para análise/);

  // pode decidir de novo e pontua de novo
  await clicar('aprovar_recrutamento', recrutador, guild, analise);
  assert.equal(await statusDaFicha(analise.id), 'APROVADO');
  assert.equal(await sinais('APROVACAO', analise.id), 1);
  assert.equal(await aprovacoes(analise.id), 1);
});

test('desfazer reprovação: cargo de reprovado sai, ficha volta a PENDENTE, sinal de reprovação some', async () => {
  const { guild, candidato, recrutador, analise } = await cenarioComFicha();
  const laudo = { categoria: 'manto', reenvio: 'nao', justificativa: 'Manto fora do padrão da torcida' };
  const { erros } = await clicar(`recrut:reprovar:${analise.id}`, recrutador, guild, analise, { campos: laudo, tipo: 'modal' });
  assert.deepEqual(erros.filter(e => !/users|fetch/i.test(e)), []);
  assert.equal(await statusDaFicha(analise.id), 'REPROVADO');
  assert.deepEqual(botoes(analise), [`recrut:desfazer:${analise.id}`]);
  assert.equal(await sinais('REPROVACAO', analise.id), 1);
  if (config.cargos.reprovadoRecrutamento) assert.ok(candidato.roles.cache.has(config.cargos.reprovadoRecrutamento));

  const { i } = await clicar(`recrut:desfazer:${analise.id}`, recrutador, guild, analise);
  assert.match(i.acao('editReply')[0].content, /REPROVAÇÃO DESFEITA/);
  assert.equal(await statusDaFicha(analise.id), 'PENDENTE');
  const [ficha] = await tabela('SELECT reprovado_categoria, reprovado_motivo, permite_reenvio FROM fichas_recrutamento WHERE message_id = $1', [analise.id]);
  assert.deepEqual(ficha, { reprovado_categoria: null, reprovado_motivo: null, permite_reenvio: null });
  assert.equal(await sinais('REPROVACAO', analise.id), 0);
  if (config.cargos.reprovadoRecrutamento) assert.equal(candidato.roles.cache.has(config.cargos.reprovadoRecrutamento), false);
  assert.ok(candidato.roles.cache.has(config.cargos.provarManto));
  assert.deepEqual(botoes(analise), ['aprovar_recrutamento', 'reprovar_recrutamento']);
  assert.equal(analise.embeds[0].fields.length, 6); // sem categoria, pode tentar de novo, justificativa
});

test('desfazer: fora dos 30 min recusa, tira o botão e não mexe em nada', async () => {
  const { guild, candidato, recrutador, analise } = await cenarioComFicha();
  await clicar('aprovar_recrutamento', recrutador, guild, analise);
  await tabela("UPDATE fichas_recrutamento SET decidido_em = now() - interval '31 minutes' WHERE message_id = $1", [analise.id]);

  const { i } = await clicar(`recrut:desfazer:${analise.id}`, recrutador, guild, analise);
  assert.match(i.acao('editReply')[0].content, /PRAZO DE 30 MINUTOS/);
  assert.equal(await statusDaFicha(analise.id), 'APROVADO');
  assert.ok(candidato.roles.cache.has(config.cargos.socio));
  assert.deepEqual(analise.components, []);
});

test('desfazer: quem não é recrutador não consegue; segundo clique no botão antigo diz que não há o que desfazer', async () => {
  const { guild, canal, candidato, recrutador, analise } = await cenarioComFicha();
  await clicar('aprovar_recrutamento', recrutador, guild, analise);
  const socioComum = criarMembro('930000000000000001', { nome: 'Socio', cargos: [config.cargos.socio] });
  guild.members.cache.set(socioComum.id, socioComum);

  const negado = await clicar(`recrut:desfazer:${analise.id}`, socioComum, guild, analise);
  assert.match(negado.i.acao('reply')[0].content, /SÓ RECRUTADOR OU LIDERANÇA/);
  assert.equal(await statusDaFicha(analise.id), 'APROVADO');

  await clicar(`recrut:desfazer:${analise.id}`, recrutador, guild, analise);
  const velho = await clicar(`recrut:desfazer:${analise.id}`, recrutador, guild, analise);
  assert.match(velho.i.acao('editReply')[0].content, /NÃO TEM DECISÃO PARA DESFAZER/);
  assert.equal(candidato.roles.cache.has(config.cargos.socio), false);
  assert.equal(canal(config.canais.telefoneSocio).enviadas.length, 1);
});

test('desfazer: se o Discord recusa tirar o cargo, nada muda no banco', async () => {
  const { guild, candidato, recrutador, analise } = await cenarioComFicha();
  await clicar('aprovar_recrutamento', recrutador, guild, analise);
  const remover = candidato.roles.remove;
  candidato.roles.remove = async () => { throw new Error('Missing Permissions'); };

  const { i } = await clicar(`recrut:desfazer:${analise.id}`, recrutador, guild, analise);
  candidato.roles.remove = remover;
  assert.match(i.acao('editReply')[0].content, /NADA FOI ALTERADO/);
  assert.equal(await statusDaFicha(analise.id), 'APROVADO');
  assert.equal(await aprovacoes(analise.id), 1);
  assert.equal(await sinais('APROVACAO', analise.id), 1);
});

test('desfazer: a tarefa do fim do prazo tira o botão só quando a decisão realmente passou de 30 min', async () => {
  const { guild, recrutador, analise } = await cenarioComFicha();
  await clicar('aprovar_recrutamento', recrutador, guild, analise);
  const tarefa = (await tabela("SELECT payload FROM tarefas_agendadas WHERE tipo = 'recrut_expirar_desfazer'")).at(-1);
  assert.equal(JSON.parse(typeof tarefa.payload === 'string' ? tarefa.payload : JSON.stringify(tarefa.payload)).fichaId, analise.id);

  const { aoExpirar } = require('../utils/recrutamento/desfazer');
  await aoExpirar(guild.client, { fichaId: analise.id }); // ainda dentro do prazo: mantém o botão
  assert.deepEqual(botoes(analise), [`recrut:desfazer:${analise.id}`]);

  await tabela("UPDATE fichas_recrutamento SET decidido_em = now() - interval '31 minutes' WHERE message_id = $1", [analise.id]);
  await aoExpirar(guild.client, { fichaId: analise.id });
  assert.deepEqual(analise.components, []);
  assert.equal(analise.content, null);
});

test('regras puras: janela, mensagem aguardando decisão e campos de decisão', () => {
  const agora = Date.parse('2026-09-24T12:00:00Z');
  const ficha = (status, minutos) => ({ status, decidido_em: new Date(agora - minutos * 60000).toISOString() });
  assert.equal(regras.avaliarDesfazer(ficha('APROVADO', 29), { agora }).ok, true);
  assert.equal(regras.avaliarDesfazer(ficha('REPROVADO', 5), { agora }).ok, true);
  assert.equal(regras.avaliarDesfazer(ficha('APROVADO', 30), { agora }).expirada, true);
  assert.equal(regras.avaliarDesfazer(ficha('PENDENTE', 1), { agora }).ok, false);
  assert.equal(regras.avaliarDesfazer(null, { agora }).ok, false);
  assert.equal(regras.avaliarDesfazer(ficha('APROVADO', 1), { agora, candidatoTemFichaMaisNova: true }).ok, false);

  assert.equal(regras.mensagemAguardaDecisao([{ components: [{ customId: 'aprovar_recrutamento' }] }]), true);
  assert.equal(regras.mensagemAguardaDecisao([{ components: [{ data: { custom_id: 'aprovar_recrutamento' } }] }]), true);
  assert.equal(regras.mensagemAguardaDecisao([{ components: [{ customId: 'recrut:desfazer:1' }] }]), false);
  assert.equal(regras.mensagemAguardaDecisao([]), false);

  const campos = [{ name: 'NOME' }, { name: 'ID | DISCORD' }, { name: 'Status' }, { name: 'STATUS' }, { name: 'CATEGORIA' }, { name: 'PODE TENTAR DE NOVO' }, { name: 'JUSTIFICATIVA' }];
  assert.deepEqual(regras.camposSemDecisao(campos).map(c => c.name), ['NOME', 'ID | DISCORD']);
});
