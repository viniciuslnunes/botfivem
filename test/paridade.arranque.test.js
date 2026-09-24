// Paridade do ARRANQUE: o antigo events/ready.js chamava uma lista fixa de rotinas
// quando o bot ficava pronto. Com os módulos por manifesto, cada módulo chama as
// suas — o conjunto tem que ser exatamente o mesmo (nenhuma rotina perdida, nenhuma
// a mais). A lista abaixo é a do ready.js original.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
process.env.DATABASE_URL = 'postgres://teste:teste@127.0.0.1:1/teste';

const chamadas = [];
const stub = (relativo, exportado) => {
  const p = require.resolve(path.join(RAIZ, relativo));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportado };
};
const rotina = (nome, valor) => (...args) => { chamadas.push(nome); return valor === undefined ? undefined : Promise.resolve(valor); };
const rotinaSync = nome => () => { chamadas.push(nome); };

stub('utils/db.js', { query: async () => { throw new Error('teste tocou no banco'); } });

// ── Stubs: cada função que o ready.js antigo chamava ─────────────────────────
stub('utils/logsJogo/ingestao.js', {
  sincronizarCanaisDeLog: rotina('sincronizarCanaisDeLog', []),
  reprocessarDesconhecidos: rotina('reprocessarDesconhecidos', { corrigidos: 0, lidos: 0 }),
});
stub('utils/logsJogo/painel.js', { iniciarPainelLogs: rotinaSync('iniciarPainelLogs') });
stub('utils/logsJogo/painelJogadores.js', { iniciarPainelJogadores: rotinaSync('iniciarPainelJogadores') });
stub('utils/logsJogo/painelSociosSemId.js', { iniciarPainelSociosSemId: rotinaSync('iniciarPainelSociosSemId') });
stub('utils/logsJogo/registrosDiarios.js', { iniciarRegistrosDiarios: rotinaSync('iniciarRegistrosDiarios') });
stub('utils/logsJogo/idsSemSocio.js', { iniciarIdsSemSocio: rotinaSync('iniciarIdsSemSocio') });
for (const [arquivo, nome] of [
  ['painelBau', 'iniciarPainelBau'], ['painelCaixa', 'iniciarPainelCaixa'], ['painelDisciplina', 'iniciarPainelDisciplina'],
  ['painelRestricoes', 'iniciarPainelRestricoes'], ['painelFechaduras', 'iniciarPainelFechaduras'], ['painelTags', 'iniciarPainelTags'],
  ['painelTerritorio', 'iniciarPainelTerritorio'], ['painelRecrutadores', 'iniciarPainelRecrutadores'], ['painelFarm', 'iniciarPainelFarm'],
  ['painelHistorico', 'iniciarPainelHistorico'],
]) stub(`utils/logsJogo/${arquivo}.js`, { [nome]: rotinaSync(nome) });

stub('utils/carteirinhaSocio.js', { reconciliarCarteirinhas: rotina('reconciliarCarteirinhas', 0) });
stub('utils/carteirinha/vencimentos.js', { iniciarVerificacaoVencimentos: rotinaSync('iniciarVerificacaoVencimentos') });
stub('utils/recrutamento/alertaNovatos.js', { iniciarAlertaNovatos: rotinaSync('iniciarAlertaNovatos') });
stub('utils/departamentos/quadro.js', { atualizarQuadroDepartamentos: rotina('atualizarQuadroDepartamentos', undefined) });
stub('utils/mensagemNaoRecrutar.js', { garantirMensagemNaoRecrutar: rotina('garantirMensagemNaoRecrutar', undefined) });
stub('utils/recrutamento/painelReenvio.js', { iniciarPainelReenvio: rotinaSync('iniciarPainelReenvio') });
stub('utils/recrutamento/painelConviteWhatsapp.js', { iniciarPainelConviteWhatsapp: rotinaSync('iniciarPainelConviteWhatsapp') });
stub('utils/recrutamento/mensagemFixa.js', { garantirMensagemRecrutamento: rotina('garantirMensagemRecrutamento', undefined) });
const ticketReal = require('../utils/ticket');
stub('utils/ticket.js', { ...ticketReal, garantirMensagemTicket: rotina('garantirMensagemTicket', undefined) });

// atualizarQuadroDepartamentos precisa devolver uma Promise com .catch
stub('utils/departamentos/quadro.js', { atualizarQuadroDepartamentos: (...a) => { chamadas.push('atualizarQuadroDepartamentos'); return Promise.resolve(); } });
stub('utils/mensagemNaoRecrutar.js', { garantirMensagemNaoRecrutar: () => { chamadas.push('garantirMensagemNaoRecrutar'); return Promise.resolve(); } });

const config = require('../config/index.js');
const tema = require('../tema');
const manifestos = require('../modulos');
const { criarPlataforma } = require('../plataforma/criar');
const { dispararSemEsperar } = require('../plataforma/executar');

// A lista do ready.js original (exceto migrações e agendador, que a plataforma
// faz antes de disparar os módulos — coberto em plataforma.eventos.test.js).
const READY_ORIGINAL = [
  'sincronizarCanaisDeLog', 'reprocessarDesconhecidos',
  // depois da sincronização, nesta ordem:
  'iniciarPainelLogs', 'iniciarPainelJogadores', 'iniciarPainelSociosSemId', 'iniciarRegistrosDiarios', 'iniciarIdsSemSocio',
  'iniciarPainelBau', 'iniciarPainelCaixa', 'iniciarPainelDisciplina', 'iniciarPainelRestricoes', 'iniciarPainelFechaduras',
  'iniciarPainelTags', 'iniciarPainelTerritorio', 'iniciarPainelRecrutadores', 'iniciarPainelFarm', 'iniciarPainelHistorico',
  // independentes:
  'reconciliarCarteirinhas', 'iniciarVerificacaoVencimentos', 'iniciarAlertaNovatos', 'atualizarQuadroDepartamentos',
  'garantirMensagemNaoRecrutar', 'iniciarPainelReenvio', 'iniciarPainelConviteWhatsapp',
  'garantirMensagemRecrutamento', 'garantirMensagemTicket',
];
const PAINEIS_APOS_SINCRONIZAR = READY_ORIGINAL.slice(2, 17);

test('arranque: os módulos ligados do tenant gavioes chamam exatamente as rotinas do ready.js original', async () => {
  const plataforma = criarPlataforma({ manifestos, tenant: config, tema });
  chamadas.length = 0;
  const silencio = { log: console.log };
  console.log = () => {};
  try {
    dispararSemEsperar(plataforma.ativos, 'aoIniciar', [{}], { contexto: plataforma.contexto });
    await new Promise(r => setTimeout(r, 200)); // deixa a cadeia de sincronização terminar
  } finally {
    console.log = silencio.log;
  }

  assert.deepEqual([...chamadas].sort(), [...READY_ORIGINAL].sort(), 'conjunto de rotinas do arranque');
  assert.equal(chamadas.length, READY_ORIGINAL.length, 'nenhuma rotina duplicada');
});

test('arranque: os painéis só sobem DEPOIS da sincronização dos logs, na ordem do ready.js original', async () => {
  const plataforma = criarPlataforma({ manifestos, tenant: config, tema });
  chamadas.length = 0;
  const original = console.log;
  console.log = () => {};
  try {
    dispararSemEsperar(plataforma.ativos, 'aoIniciar', [{}], { contexto: plataforma.contexto });
    await new Promise(r => setTimeout(r, 200));
  } finally {
    console.log = original;
  }
  const iSincronizou = chamadas.indexOf('reprocessarDesconhecidos');
  const posicoes = PAINEIS_APOS_SINCRONIZAR.map(n => chamadas.indexOf(n));
  assert.ok(posicoes.every(p => p > iSincronizou), 'painel subiu antes do fim da sincronização');
  assert.deepEqual(posicoes, [...posicoes].sort((a, b) => a - b), 'ordem dos painéis mudou');
});

test('arranque: torcida sem farm, recrutadores e recrutamento não chama as rotinas desses módulos', async () => {
  const exemplo = require('../tenants/_exemplo/tenant.js');
  const plataforma = criarPlataforma({ manifestos, tenant: exemplo, tema });
  chamadas.length = 0;
  const original = console.log;
  console.log = () => {};
  try {
    dispararSemEsperar(plataforma.ativos, 'aoIniciar', [{}], { contexto: plataforma.contexto });
    await new Promise(r => setTimeout(r, 200));
  } finally {
    console.log = original;
  }
  for (const desligada of ['iniciarPainelFarm', 'iniciarPainelRecrutadores']) assert.ok(!chamadas.includes(desligada), desligada);
  for (const ligada of ['iniciarPainelBau', 'sincronizarCanaisDeLog', 'garantirMensagemTicket', 'iniciarAlertaNovatos']) assert.ok(chamadas.includes(ligada), ligada);
});

// ── Ordem dos hooks de mensagem e de membro (ordem do antigo messageCreate) ──
test('mensagem: a ordem dos módulos com aoMensagem é a do antigo messageCreate (log → anti-spam → texto → validar ID)', () => {
  const ids = manifestos.filter(m => m.aoMensagem).map(m => m.id);
  assert.deepEqual(ids, ['logsJogo', 'antiSpam', 'sociais', 'bloqueioId']);
});

test('membro: os módulos com aoMembroAtualizado cobrem tudo que o antigo guildMemberUpdate tratava', () => {
  const ids = manifestos.filter(m => m.aoMembroAtualizado).map(m => m.id).sort();
  // hierarquia, quadro de recrutadores, elenco, carteirinha, áreas (departamentos),
  // sócio sem ID e IDs sem Discord (logsJogo)
  assert.deepEqual(ids, ['carteirinha', 'departamentos', 'elenco', 'hierarquia', 'logsJogo', 'recrutamento']);
});

test('reação: só o módulo de eventos trata reação (adicionada e removida)', () => {
  assert.deepEqual(manifestos.filter(m => m.aoReacaoAdicionada).map(m => m.id), ['eventos']);
  assert.deepEqual(manifestos.filter(m => m.aoReacaoRemovida).map(m => m.id), ['eventos']);
});
