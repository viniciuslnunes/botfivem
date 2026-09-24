// Comportamento dos hooks dos módulos (o que antes vivia em events/*.js, sem
// nenhum teste). Dependências externas (banco, Discord) são trocadas por
// stubs no cache do require ANTES de carregar o código sob teste.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
process.env.DATABASE_URL = 'postgres://teste:teste@127.0.0.1:1/teste';

function stub(relativo, exportado) {
  const p = require.resolve(path.join(RAIZ, relativo));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportado };
}

// Banco sempre proibido nestes testes.
stub('utils/db.js', { query: async () => { throw new Error('teste tocou no banco'); } });

const chamadas = [];
const reg = (...a) => chamadas.push(a);
const limpar = () => { chamadas.length = 0; };

// ── Stubs do pipeline de logs ────────────────────────────────────────────────
const estado = { gravarFalha: false };
stub('utils/logsJogo/ingestao.js', {
  ehMensagemDeLog: m => m.log === true,
  registrosDaMensagem: m => m.registros,
  gravarRegistros: async r => { if (estado.gravarFalha) throw new Error('db fora'); return r; },
});
stub('utils/logsJogo/alertas.js', { avaliarAlertas: async (c, novos) => reg('alertas', novos.length) });
stub('utils/logsJogo/painelJogadores.js', {
  agendarAtualizacaoReativa: () => reg('agendarPresenca'),
  atualizarPainelJogadores: async () => reg('atualizarPainelJogadores'),
});
stub('utils/logsJogo/registrosDiarios.js', { agendarAtualizacaoReativa: () => reg('agendarRegistrosDiarios') });
stub('utils/logsJogo/idsSemSocio.js', { agendarAtualizacaoReativa: () => reg('agendarIds') });
stub('utils/logsJogo/presencaInteracoes.js', { incrementarSociosManual: async n => reg('incrementarSocios', n) });

const { processarMensagemDeLog } = require('../utils/logsJogo/pipeline');

function silenciarErros(fn) {
  const original = console.error;
  const vistos = [];
  console.error = (...a) => vistos.push(a);
  return Promise.resolve(fn(vistos)).finally(() => { console.error = original; });
}

const msgLog = registros => ({ log: true, registros });
const client = {};

test('pipeline: mensagem que não é log não é consumida e nada roda', async () => {
  limpar();
  assert.equal(await processarMensagemDeLog({ log: false }, client, []), false);
  assert.deepEqual(chamadas, []);
});

test('pipeline: log de conexão acorda presença e registros diários (e só isso)', async () => {
  limpar();
  const r = await processarMensagemDeLog(msgLog([{ categoria: 'conexao' }]), client, []);
  assert.equal(r, true);
  assert.deepEqual(chamadas.map(c => c[0]), ['alertas', 'agendarPresenca', 'agendarRegistrosDiarios']);
});

test('pipeline: log com ID de jogador acorda o canal de IDs sem Discord (ator ou alvo)', async () => {
  for (const registro of [{ categoria: 'x', atorIdFivem: 5 }, { categoria: 'x', alvoIdFivem: 6 }]) {
    limpar();
    await processarMensagemDeLog(msgLog([registro]), client, []);
    assert.ok(chamadas.some(c => c[0] === 'agendarIds'));
  }
  limpar();
  await processarMensagemDeLog(msgLog([{ categoria: 'x' }]), client, []);
  assert.ok(!chamadas.some(c => c[0] === 'agendarIds'));
});

test('pipeline: recrutamentos somam em sócios setados e atualizam o painel, nessa ordem', async () => {
  limpar();
  await processarMensagemDeLog(msgLog([{ acao: 'jogador_recrutou' }, { acao: 'jogador_recrutou' }, { acao: 'outra' }]), client, []);
  const nomes = chamadas.map(c => c[0]);
  assert.deepEqual(chamadas.find(c => c[0] === 'incrementarSocios'), ['incrementarSocios', 2]);
  assert.ok(nomes.indexOf('incrementarSocios') < nomes.indexOf('atualizarPainelJogadores'));
});

test('pipeline: banco fora do ar não cala o alerta (avalia com o que chegou)', async () => {
  limpar();
  estado.gravarFalha = true;
  await silenciarErros(async vistos => {
    const r = await processarMensagemDeLog(msgLog([{ categoria: 'x' }, { categoria: 'y' }]), client, []);
    assert.equal(r, true);
    assert.ok(vistos.some(v => String(v[0]).includes('Erro ao gravar log')));
  });
  estado.gravarFalha = false;
  assert.deepEqual(chamadas.find(c => c[0] === 'alertas'), ['alertas', 2]);
});

test('pipeline: cada painel de log recebe os registros novos; um painel com erro não impede os outros', async () => {
  limpar();
  const visto = [];
  const paineis = [
    { aoRegistros: async novos => { visto.push(['a', novos.length]); } },
    { aoRegistros: async () => { throw new Error('painel quebrado'); } },
    { iniciar() {} }, // sem aoRegistros: ignorado
    { aoRegistros: async novos => { visto.push(['c', novos.length]); } },
  ];
  await silenciarErros(async vistos => {
    assert.equal(await processarMensagemDeLog(msgLog([{ categoria: 'bau' }]), client, paineis), true);
    assert.ok(vistos.some(v => String(v[0]).includes('Erro num painel de log')));
  });
  assert.deepEqual(visto, [['a', 1], ['c', 1]]);
});

// ── Painéis de log (manifestos) ──────────────────────────────────────────────
function stubPainel(arquivo, extras = {}) {
  const exportado = { agendarAtualizacaoReativa: () => reg('agendar', arquivo), ...extras };
  stub(`utils/logsJogo/${arquivo}.js`, exportado);
}
for (const f of ['painelBau', 'painelDisciplina', 'painelRestricoes', 'painelFechaduras', 'painelTags', 'painelTerritorio', 'painelRecrutadores', 'painelFarm', 'painelCaixa']) stubPainel(f);
stub('utils/logsJogo/painelCaixaInteracoes.js', {
  deltaCaixa: novos => novos.reduce((s, r) => s + (r.delta || 0), 0),
  incrementarSaldoCaixaManual: async d => reg('saldoManual', d),
});

const CATEGORIA_POR_PAINEL = {
  painelBau: 'bau', painelDisciplina: 'disciplina', painelRestricoes: 'restricao', painelFechaduras: 'patrimonio',
  painelTags: 'tag', painelTerritorio: 'territorio', painelFarm: 'bau', painelCaixa: 'economia',
};

test('painéis: cada um acorda só com a categoria de log que é dele (mesma tabela do antigo messageCreate)', async () => {
  const todas = ['bau', 'economia', 'disciplina', 'restricao', 'patrimonio', 'tag', 'territorio', 'conexao', 'outra'];
  for (const [id, categoria] of Object.entries(CATEGORIA_POR_PAINEL)) {
    const { painelLog } = require(`../modulos/${id}`);
    for (const c of todas) {
      limpar();
      await painelLog.aoRegistros([{ categoria: c }], client);
      const acordou = chamadas.some(x => x[0] === 'agendar');
      assert.equal(acordou, c === categoria, `${id} com categoria ${c}`);
    }
  }
});

test('painelRecrutadores: acorda com conexão OU com jogador_recrutou, nada além', async () => {
  const { painelLog } = require('../modulos/painelRecrutadores');
  const casos = [[{ categoria: 'conexao' }, true], [{ acao: 'jogador_recrutou' }, true], [{ categoria: 'bau' }, false], [{ acao: 'saiu' }, false]];
  for (const [registro, esperado] of casos) {
    limpar();
    await painelLog.aoRegistros([registro], client);
    assert.equal(chamadas.some(x => x[0] === 'agendar'), esperado, JSON.stringify(registro));
  }
});

test('painelCaixa: além de acordar, ajusta o saldo manual só quando há delta (depósito/saque)', async () => {
  const { painelLog } = require('../modulos/painelCaixa');
  limpar();
  await painelLog.aoRegistros([{ categoria: 'economia', delta: 5000 }, { categoria: 'economia', delta: -1500 }], client);
  assert.deepEqual(chamadas.find(x => x[0] === 'saldoManual'), ['saldoManual', 3500]);
  limpar();
  await painelLog.aoRegistros([{ categoria: 'economia', delta: 0 }], client);
  assert.ok(!chamadas.some(x => x[0] === 'saldoManual'));
  assert.ok(chamadas.some(x => x[0] === 'agendar'));
});

test('painelHistorico não acorda com log (é sob demanda) mas tem iniciar', () => {
  const { painelLog } = require('../modulos/painelHistorico');
  assert.equal(typeof painelLog.iniciar, 'function');
});

// ── Membro atualizado ────────────────────────────────────────────────────────
const config = require('../config/index.js');
const membro = (cargos, extra = {}) => ({
  id: 'u1', nickname: null, displayName: 'Fulano',
  roles: { cache: new Map(cargos.map(c => [c, {}])) }, ...extra,
});

stub('utils/hierarquiaEmbed.js', { HIERARQUIA: [{ id: 'CARGO_H1' }, { id: 'CARGO_H2' }], atualizarHierarquia: async () => reg('hierarquia') });
stub('utils/elenco.js', { CARGO_ELENCO: 'CARGO_E', atualizarElenco: async () => reg('elenco') });
stub('utils/quadroRecrutadores.js', { CARGO_RECRUTADOR: 'CARGO_R', atualizarQuadroRecrutadores: async () => reg('quadroRecrutadores') });
stub('utils/carteirinhaSocio.js', { sincronizarCarteirinhaComCargo: async (c, id, ehSocio) => reg('carteirinha', id, ehSocio) });
stub('utils/departamentos/gestao.js', { removerTodasAsAreas: async () => reg('removerAreas') });
stub('utils/departamentos/repositorio.js', { mapaCargosDepartamento: async () => new Map([['CARGO_AREA', {}]]) });
stub('utils/departamentos/quadro.js', { agendarAtualizacaoQuadro: () => reg('quadroDepartamentos') });
stub('utils/logsJogo/painelSociosSemId.js', { agendarAtualizacaoReativa: () => reg('agendarSociosSemId') });

test('hierarquia: só reage a cargo da hierarquia (ganhar ou perder)', async () => {
  const { aoMembroAtualizado } = require('../modulos/hierarquia');
  for (const [antes, depois, esperado] of [
    [[], ['CARGO_H1'], true], [['CARGO_H2'], [], true], [['CARGO_H1'], ['CARGO_H1'], false], [[], ['OUTRO'], false],
  ]) {
    limpar();
    await aoMembroAtualizado(membro(antes), membro(depois), client);
    assert.equal(chamadas.some(c => c[0] === 'hierarquia'), esperado, `${antes} → ${depois}`);
  }
});

test('elenco e recrutamento: quadro atualiza quando o cargo próprio muda', async () => {
  const elenco = require('../modulos/elenco');
  const recrutamento = require('../modulos/recrutamento');
  limpar();
  await elenco.aoMembroAtualizado(membro([]), membro(['CARGO_E']), client);
  await elenco.aoMembroAtualizado(membro(['CARGO_E']), membro(['CARGO_E']), client);
  assert.deepEqual(chamadas.map(c => c[0]), ['elenco']);
  limpar();
  await recrutamento.aoMembroAtualizado(membro(['CARGO_R']), membro([]), client);
  await recrutamento.aoMembroAtualizado(membro([]), membro(['OUTRO']), client);
  assert.deepEqual(chamadas.map(c => c[0]), ['quadroRecrutadores']);
});

test('carteirinha: sincroniza só quando o cargo SÓCIO muda, dizendo se voltou ou saiu', async () => {
  const { aoMembroAtualizado } = require('../modulos/carteirinha');
  const socio = config.cargos.socio;
  limpar();
  await aoMembroAtualizado(membro([socio]), membro([]), client);
  await aoMembroAtualizado(membro([]), membro([socio]), client);
  await aoMembroAtualizado(membro([socio]), membro([socio]), client);
  await aoMembroAtualizado(membro([]), membro(['OUTRO']), client);
  assert.deepEqual(chamadas, [['carteirinha', 'u1', false], ['carteirinha', 'u1', true]]);
});

test('departamentos: perder SÓCIO remove das áreas; mudar cargo de área reagenda o quadro', async () => {
  const { aoMembroAtualizado } = require('../modulos/departamentos');
  const socio = config.cargos.socio;
  limpar();
  await aoMembroAtualizado(membro([socio]), membro([]), client);
  assert.deepEqual(chamadas.map(c => c[0]), ['removerAreas']);
  limpar();
  await aoMembroAtualizado(membro([]), membro([socio]), client); // ganhou sócio: não remove
  assert.deepEqual(chamadas.map(c => c[0]), []);
  limpar();
  await aoMembroAtualizado(membro([]), membro(['CARGO_AREA']), client);
  await aoMembroAtualizado(membro(['CARGO_AREA']), membro([]), client);
  assert.deepEqual(chamadas.map(c => c[0]), ['quadroDepartamentos', 'quadroDepartamentos']);
});

test('logsJogo: apelido com ID novo reagenda "sem ID" (sócio) e "IDs sem Discord" (qualquer um)', () => {
  const { aoMembroAtualizado } = require('../modulos/logsJogo');
  const socio = config.cargos.socio;
  const comNick = (cargos, nick) => membro(cargos, { nickname: nick });

  limpar(); // sócio troca o ID do apelido
  aoMembroAtualizado(comNick([socio], 'S GDF | Fulano - 100'), comNick([socio], 'S GDF | Fulano - 200'), client);
  assert.deepEqual(chamadas.map(c => c[0]).sort(), ['agendarIds', 'agendarSociosSemId']);

  limpar(); // não-sócio troca o ID: só o canal de IDs sem Discord
  aoMembroAtualizado(comNick([], 'S GDF | Fulano - 100'), comNick([], 'S GDF | Fulano - 200'), client);
  assert.deepEqual(chamadas.map(c => c[0]), ['agendarIds']);

  limpar(); // ganhou o cargo SÓCIO sem mudar o ID: só "sem ID"
  aoMembroAtualizado(comNick([], 'S GDF | Fulano - 100'), comNick([socio], 'S GDF | Fulano - 100'), client);
  assert.deepEqual(chamadas.map(c => c[0]), ['agendarSociosSemId']);

  limpar(); // nada mudou de relevante
  aoMembroAtualizado(comNick([socio], 'S GDF | Fulano - 100'), comNick([socio], 'S GDF | Fulano - 100'), client);
  assert.deepEqual(chamadas, []);
});

// ── Mensagens de texto ───────────────────────────────────────────────────────
test('sociais: !ping, !sociais e !parceiros; qualquer outro texto é ignorado', async () => {
  const { aoMensagem } = require('../utils/sociais');
  const tema = require('../tema');
  const enviados = [];
  const msg = content => ({
    content,
    reply: async p => { enviados.push(['reply', p]); },
    channel: { send: async p => { enviados.push(['send', p]); } },
  });

  await aoMensagem(msg('!ping'));
  assert.deepEqual(enviados, [['reply', 'Pong!']]);

  enviados.length = 0;
  await aoMensagem(msg('!sociais'));
  const social = enviados[0][1];
  assert.equal(social.embeds[0].title, '🌐 REDES SOCIAIS DOS GAVIÕES DA FIEL - FIVEM');
  assert.equal(social.embeds[0].color, tema.cor.primaria);
  assert.ok(social.embeds[0].description.includes(config.links.redesSociais));
  assert.equal(social.files[0].name, tema.marca.logo);

  enviados.length = 0;
  await aoMensagem(msg('!parceiros'));
  const parceiros = enviados[0][1];
  assert.equal(parceiros.embeds[0].title, '🤝 PARCEIROS DOS GAVIÕES DA FIEL - FIVEM');
  assert.equal(parceiros.embeds[0].description, tema.marca.textos.parceiros);
  const botoes = parceiros.components[0].components;
  assert.deepEqual(botoes.map(b => b.data.label), config.parceiros.map(p => p.label));
  assert.deepEqual(botoes.map(b => b.data.url), config.parceiros.map(p => p.url));

  enviados.length = 0;
  await aoMensagem(msg('oi gente'));
  assert.deepEqual(enviados, []);
});

test('bloqueioId: botão aparece nos canais de validar/não recrutar para gente, nunca para bot', async () => {
  const { aoMensagem } = require('../utils/naoRecrutarMensagens');
  const respostas = [];
  const msg = (canal, bot) => ({ channelId: canal, author: { bot }, reply: async p => { respostas.push(p); } });

  await aoMensagem(msg(config.canais.validarId, false));
  assert.equal(respostas.length, 1);
  assert.deepEqual(respostas[0].components[0].components.map(b => b.data.custom_id), ['abrir_validarid']);

  respostas.length = 0;
  await aoMensagem(msg(config.canais.naoRecrutar, false));
  assert.deepEqual(respostas[0].components[0].components.map(b => b.data.custom_id), ['abrir_bloquearid', 'abrir_desbloquearid']);

  respostas.length = 0;
  await aoMensagem(msg(config.canais.validarId, true)); // bot
  await aoMensagem(msg(config.canais.naoRecrutar, true)); // bot
  await aoMensagem(msg('999999999999999999', false)); // outro canal
  assert.deepEqual(respostas, []);
});

// ── Reações de evento ────────────────────────────────────────────────────────
test('eventos: só reação de confirmar (🦅) em mensagem de evento do bot atualiza a lista', async () => {
  const atualizadas = [];
  stub('utils/eventoDebounce.js', { atualizarListaEvento: async m => { atualizadas.push(m); } });
  const { tratarReacaoDeEvento } = require('../utils/eventos/reacoes');

  const mensagem = (extra = {}) => ({ partial: false, author: { bot: true }, embeds: [{ footer: { text: 'evento' } }], ...extra });
  const reacao = (emoji, msg = mensagem(), extra = {}) => ({ partial: false, emoji: { name: emoji, id: null }, message: msg, ...extra });

  await tratarReacaoDeEvento(reacao('🦅'), { bot: false });
  assert.equal(atualizadas.length, 1);

  await tratarReacaoDeEvento(reacao('❌'), { bot: false }); // recusar não atualiza
  await tratarReacaoDeEvento(reacao('👍'), { bot: false }); // emoji qualquer
  await tratarReacaoDeEvento(reacao('🦅'), { bot: true }); // usuário bot
  await tratarReacaoDeEvento(reacao('🦅', mensagem({ author: { bot: false } })), { bot: false }); // mensagem de gente
  await tratarReacaoDeEvento(reacao('🦅', mensagem({ embeds: [{ footer: { text: 'outro' } }] })), { bot: false });
  await tratarReacaoDeEvento(reacao('🦅', mensagem({ embeds: [] })), { bot: false });
  await tratarReacaoDeEvento({ ...reacao('🦅'), emoji: { name: '🦅', id: '123' } }, { bot: false }); // emoji customizado com mesmo nome
  assert.equal(atualizadas.length, 1);

  // reação parcial que não consegue carregar: sai sem erro
  await tratarReacaoDeEvento(reacao('🦅', mensagem(), { partial: true, fetch: async () => { throw new Error('x'); } }), { bot: false });
  assert.equal(atualizadas.length, 1);
});
