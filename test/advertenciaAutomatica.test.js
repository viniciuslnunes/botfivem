// Advertência automática de sócio: impedimento/advertência do painel do jogo vira
// advertência no Discord (1ª aviso, 2ª pagamento no baú em 2 dias, 3ª perde o cargo).
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_SSL = 'off';
const { instalarBanco } = require('../tools/banco-em-memoria');
const { criarCanal, criarMembro, criarServidor } = require('../tools/discord-falso');
const R = require('../utils/advertencia/automaticaRegras');

let banco;
let config;
let auto;
let repo;
let guild;
let membro;
let historico;
let pendentes;
let seq = 0;

const texto = canal => JSON.stringify(canal.enviadas.map(m => m.embeds));
const agora = () => new Date();
const registro = extra => ({ messageId: `L${++seq}`, ocorridoEm: agora(), atorNome: 'Liderança', ...extra });
const impedimento = () => registro({ acao: 'impedimento_adicionou', alvoIdFivem: '1234', descricao: '#1 Liderança adicionou impedimento #1234 Fulano (falta em evento)' });
const bau = (item, qtd) => registro({ acao: 'bau_guardou', atorIdFivem: '1234', alvoNome: item, valor: qtd });

test.before(async () => {
  banco = await instalarBanco();
  config = require('../config/index.js');
  auto = require('../utils/advertencia/automatica');
  repo = require('../utils/advertencia/repositorio');
  historico = criarCanal(config.canais.historicoAdv, 'historico-adv');
  pendentes = criarCanal(config.canais.advPendentes, 'advertencias-pendentes');
  membro = criarMembro('D1', { cargos: [config.cargos.socio], apelido: 'S GDF | Fulano - 1234' });
  guild = criarServidor({ canais: [historico, pendentes], membros: [membro] });
});
test.after(async () => { await banco.pglite.close(); });

const temCargo = id => membro.roles.cache.has(id);
const zerarJanela = () => banco.q("UPDATE advertencias_socio SET criada_em = criada_em - interval '1 hour'");

test('regras: só impedimento/advertência abrem, retirada fecha, log velho e sem alvo não contam', () => {
  assert.equal(R.gatilho({ acao: 'impedimento_adicionou', alvoIdFivem: '1' }).origem, 'impedimento');
  assert.equal(R.gatilho({ acao: 'advertido', alvoIdFivem: '1' }).tipo, 'abrir');
  assert.equal(R.gatilho({ acao: 'impedimento_removeu', alvoIdFivem: '1' }).tipo, 'fechar');
  assert.equal(R.gatilho({ acao: 'impedimento_adicionou', alvoIdFivem: null }), null);
  assert.equal(R.gatilho({ acao: 'blacklist_adicionou', alvoIdFivem: '1' }), null);
  assert.equal(R.gatilho({ acao: 'impedimento_adicionou', alvoIdFivem: '1', ocorridoEm: new Date(Date.now() - 7 * 3600e3) }), null);
  assert.equal(R.itemDePagamento({ acao: 'bau_guardou', atorIdFivem: '1', alvoNome: 'Cocaína' }), 'cocaina');
  assert.equal(R.itemDePagamento({ acao: 'bau_guardou', atorIdFivem: '1', alvoNome: 'tecido' }), null);
  assert.equal(R.itemDePagamento({ acao: 'bau_removeu', atorIdFivem: '1', alvoNome: 'Maconha' }), null);
});

test('1ª: impedimento vira ADV¹ com aviso formal e justificativa', async () => {
  await auto.aoRegistros([impedimento()], guild.client);
  const [a] = await banco.q('SELECT * FROM advertencias_socio');
  assert.equal(a.nivel, 1);
  assert.equal(a.status, 'ATIVA');
  assert.ok(temCargo(config.cargos.adv[0]));
  assert.match(texto(historico), /1ª ADVERTÊNCIA — AVISO FORMAL[\s\S]*falta em evento/);
});

test('duplicado (mesmo instante) não abre outra advertência', async () => {
  await auto.aoRegistros([impedimento()], guild.client);
  assert.equal((await banco.q('SELECT 1 FROM advertencias_socio')).length, 1);
});

test('retirar o impedimento remove a advertência e o cargo', async () => {
  await auto.aoRegistros([registro({ acao: 'impedimento_removeu', alvoIdFivem: '1234' })], guild.client);
  const [a] = await banco.q('SELECT status FROM advertencias_socio');
  assert.equal(a.status, 'REMOVIDA');
  assert.ok(!temCargo(config.cargos.adv[0]));
  assert.match(texto(historico), /ADVERTÊNCIA REMOVIDA/);
});

test('2ª: cobra 50 maconha + 50 cocaína em 2 dias e agenda o vencimento', async () => {
  await zerarJanela();
  await auto.aoRegistros([impedimento()], guild.client); // nova 1ª
  await zerarJanela();
  await auto.aoRegistros([impedimento()], guild.client); // 2ª
  assert.ok(temCargo(config.cargos.adv[1]) && !temCargo(config.cargos.adv[0]));
  const [seg] = await banco.q('SELECT * FROM advertencias_socio WHERE nivel = 2');
  assert.ok(seg.prazo_em);
  assert.match(texto(pendentes), /2ª ADVERTÊNCIA — PAGAMENTO PENDENTE[\s\S]*50 maconha \+ 50 cocaina/);
  const [t] = await banco.q("SELECT payload FROM tarefas_agendadas WHERE tipo = 'adv_vencimento' ORDER BY id DESC LIMIT 1");
  assert.equal(t.payload.advId, seg.id);
});

test('pagamento parcial não baixa; completo baixa, remove o cargo e registra', async () => {
  await auto.aoRegistros([bau('Maconha', 50), bau('tecido', 999), bau('Cocaína', 20)], guild.client);
  let [seg] = await banco.q('SELECT * FROM advertencias_socio WHERE nivel = 2');
  assert.equal(seg.status, 'ATIVA');
  assert.deepEqual(seg.pago, { maconha: 50, cocaina: 20 });

  await auto.aoRegistros([bau('Cocaína', 30)], guild.client);
  [seg] = await banco.q('SELECT * FROM advertencias_socio WHERE nivel = 2');
  assert.equal(seg.status, 'PAGA');
  assert.ok(!temCargo(config.cargos.adv[1]));
  assert.ok(temCargo(config.cargos.adv[0]), 'volta a ADV¹ como na remoção manual');
  assert.ok(temCargo(config.cargos.socio), 'pagou: continua sócio');
  assert.match(texto(pendentes), /2ª ADVERTÊNCIA PAGA E REMOVIDA/);
});

test('depósito depois de pago (ou de outro jogador) não mexe em nada', async () => {
  await auto.aoRegistros([bau('Maconha', 500), { ...bau('Maconha', 500), atorIdFivem: '9999' }], guild.client);
  const [{ n }] = await banco.q("SELECT count(*)::int AS n FROM advertencias_socio WHERE status = 'ATIVA' AND nivel = 2");
  assert.equal(n, 0);
});

test('3ª: remove o cargo de sócio e registra', async () => {
  await zerarJanela();
  await auto.aoRegistros([impedimento()], guild.client); // ADV¹ → 2ª
  await zerarJanela();
  await auto.aoRegistros([impedimento()], guild.client); // 2ª → 3ª
  const [terc] = await banco.q('SELECT * FROM advertencias_socio WHERE nivel = 3');
  assert.equal(terc.status, 'CARGO_REMOVIDO');
  assert.ok(!temCargo(config.cargos.socio));
  assert.ok(temCargo(config.cargos.adv[2]));
  assert.match(texto(historico), /3ª ADVERTÊNCIA — CARGO DE SÓCIO REMOVIDO/);
  // quem já não é sócio não recebe mais advertência automática
  const antes = (await banco.q('SELECT 1 FROM advertencias_socio')).length;
  await zerarJanela();
  await auto.aoRegistros([impedimento()], guild.client);
  assert.equal((await banco.q('SELECT 1 FROM advertencias_socio')).length, antes);
});

test('histórico do membro lista todas', async () => {
  assert.ok((await repo.historicoDoMembro('D1')).length >= 4);
});
