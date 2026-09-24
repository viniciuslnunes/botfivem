// Despacho de eventos do Discord para os módulos (plataforma/eventos.js): o que
// antes era events/*.js. Cliente e interações falsos; nenhum banco.
const test = require('node:test');
const assert = require('node:assert/strict');
const { registrarEventos } = require('../plataforma/eventos');
const { registrarModulo } = require('../utils/modulos');

function clienteFalso() {
  const handlers = {};
  return {
    handlers,
    commands: new Map(),
    user: { tag: 'Bot#0001' },
    once(ev, fn) { handlers[ev] = fn; },
    on(ev, fn) { handlers[ev] = fn; },
  };
}

function montar(ativos, extras = {}) {
  const client = clienteFalso();
  const idsAtivos = new Set(ativos.map(m => m.id));
  const chamadas = [];
  registrarEventos(client, { ativos, idsAtivos, contexto: { marca: 'ctx' } }, {
    executarMigracoes: async ids => { chamadas.push(['migracoes', [...ids]]); },
    iniciarAgendador: () => { chamadas.push(['agendador']); },
    ...extras,
  });
  return { client, chamadas };
}

const silenciar = async fn => {
  const orig = { log: console.log, error: console.error };
  const erros = [];
  console.log = () => {};
  console.error = (...a) => erros.push(a);
  try { return await fn(erros); } finally { Object.assign(console, orig); }
};

test('registra exatamente os 6 eventos do bot', () => {
  const { client } = montar([]);
  assert.deepEqual(Object.keys(client.handlers).sort(),
    ['clientReady', 'guildMemberUpdate', 'interactionCreate', 'messageCreate', 'messageReactionAdd', 'messageReactionRemove']);
});

test('clientReady: migra só os módulos ligados, sobe o agendador e DEPOIS dispara aoIniciar sem esperar', async () => {
  const ordem = [];
  const ativos = [
    { id: 'a', aoIniciar: async (c, ctx) => { ordem.push(['a', ctx.marca]); await new Promise(r => setTimeout(r, 30)); ordem.push('a-fim'); } },
    { id: 'b', aoIniciar: () => { ordem.push('b'); } },
  ];
  const { client, chamadas } = montar(ativos, {
    executarMigracoes: async ids => { ordem.push(['migracoes', [...ids]]); },
    iniciarAgendador: () => { ordem.push('agendador'); },
  });
  await silenciar(() => client.handlers.clientReady());
  assert.deepEqual(ordem.slice(0, 4), [['migracoes', ['a', 'b']], 'agendador', ['a', 'ctx'], 'b']);
  assert.ok(!ordem.includes('a-fim')); // não esperou o lento
  await new Promise(r => setTimeout(r, 50));
  assert.ok(ordem.includes('a-fim'));
  assert.deepEqual(chamadas, []);
});

test('messageCreate: para no primeiro módulo que consome e passa (message, client, ctx)', async () => {
  const vistos = [];
  const ativos = [
    { id: 'a', aoMensagem: (m, c, ctx) => { vistos.push(['a', m.id, ctx.marca]); return false; } },
    { id: 'b', aoMensagem: () => { vistos.push('b'); return true; } },
    { id: 'c', aoMensagem: () => { vistos.push('c'); } },
  ];
  const { client } = montar(ativos);
  await client.handlers.messageCreate({ id: 'm1' });
  assert.deepEqual(vistos, [['a', 'm1', 'ctx'], 'b']);
});

test('guildMemberUpdate e reações chegam a todos os módulos ligados, em ordem', async () => {
  const vistos = [];
  const ativos = ['a', 'b'].map(id => ({
    id,
    aoMembroAtualizado: (antes, depois) => { vistos.push([id, 'membro', antes, depois]); },
    aoReacaoAdicionada: (r, u) => { vistos.push([id, 'add', r, u]); },
    aoReacaoRemovida: (r, u) => { vistos.push([id, 'rem', r, u]); },
  }));
  const { client } = montar(ativos);
  await client.handlers.guildMemberUpdate('A', 'D');
  await client.handlers.messageReactionAdd('R', 'U');
  await client.handlers.messageReactionRemove('R2', 'U2');
  assert.deepEqual(vistos, [
    ['a', 'membro', 'A', 'D'], ['b', 'membro', 'A', 'D'],
    ['a', 'add', 'R', 'U'], ['b', 'add', 'R', 'U'],
    ['a', 'rem', 'R2', 'U2'], ['b', 'rem', 'R2', 'U2'],
  ]);
});

// ── interactionCreate ────────────────────────────────────────────────────────
const interacao = (extra = {}) => ({
  customId: undefined, commandName: undefined, replied: false, deferred: false,
  isAutocomplete: () => false, isChatInputCommand: () => false, isRepliable: () => true,
  respostas: [],
  reply(p) { this.respostas.push(['reply', p]); return Promise.resolve(); },
  editReply(p) { this.respostas.push(['editReply', p]); return Promise.resolve(); },
  followUp(p) { this.respostas.push(['followUp', p]); return Promise.resolve(); },
  ...extra,
});

test('interactionCreate: autocomplete chama o autocomplete do comando (e ignora comando sem ele)', async () => {
  const { client } = montar([]);
  const chamado = [];
  client.commands.set('c1', { autocomplete: async i => { chamado.push(i.commandName); } });
  client.commands.set('c2', {});
  await client.handlers.interactionCreate(interacao({ commandName: 'c1', isAutocomplete: () => true }));
  await client.handlers.interactionCreate(interacao({ commandName: 'c2', isAutocomplete: () => true }));
  await client.handlers.interactionCreate(interacao({ commandName: 'nada', isAutocomplete: () => true }));
  assert.deepEqual(chamado, ['c1']);
});

test('interactionCreate: customId registrado vai para o handler do módulo e não chega ao comando slash', async () => {
  const { client } = montar([]);
  const vistos = [];
  registrarModulo('teste_prefixo', async i => { vistos.push(i.customId); });
  client.commands.set('x', { execute: async () => vistos.push('comando') });
  await client.handlers.interactionCreate(interacao({ customId: 'teste_prefixo:abc:1', isChatInputCommand: () => true, commandName: 'x' }));
  assert.deepEqual(vistos, ['teste_prefixo:abc:1']);
});

test('interactionCreate: comando slash executa; desconhecido é ignorado; erro responde ao usuário', async () => {
  const { client } = montar([]);
  const feitos = [];
  client.commands.set('ok', { execute: async i => { feitos.push(i.commandName); } });
  client.commands.set('quebra', { execute: async () => { throw new Error('falhou'); } });

  await client.handlers.interactionCreate(interacao({ commandName: 'ok', isChatInputCommand: () => true }));
  await client.handlers.interactionCreate(interacao({ commandName: 'inexistente', isChatInputCommand: () => true }));
  assert.deepEqual(feitos, ['ok']);

  await silenciar(async erros => {
    const i1 = interacao({ commandName: 'quebra', isChatInputCommand: () => true });
    await client.handlers.interactionCreate(i1);
    assert.deepEqual(i1.respostas, [['reply', { content: 'ERRO AO EXECUTAR COMANDO.', flags: 64 }]]);
    assert.equal(erros.length, 1);

    const i2 = interacao({ commandName: 'quebra', isChatInputCommand: () => true, deferred: true });
    await client.handlers.interactionCreate(i2);
    assert.deepEqual(i2.respostas, [['followUp', { content: 'ERRO AO EXECUTAR COMANDO.', flags: 64 }]]);
  });
});

test('interactionCreate: interação expirada (10062) ou já respondida (40060) não gera resposta nem log', async () => {
  const { client } = montar([]);
  for (const code of [10062, 40060]) {
    client.commands.set('velho', { execute: async () => { const e = new Error('x'); e.code = code; throw e; } });
    await silenciar(async erros => {
      const i = interacao({ commandName: 'velho', isChatInputCommand: () => true });
      await client.handlers.interactionCreate(i);
      assert.deepEqual(i.respostas, []);
      assert.deepEqual(erros, []);
    });
  }
});

test('interactionCreate: erro num handler de botão responde "ocorreu um erro" em vez de deixar pensando (defer → editReply)', async () => {
  const { client } = montar([]);
  registrarModulo('quebrado', async () => { throw new Error('boom'); });

  await silenciar(async erros => {
    const ao = interacao({ customId: 'quebrado:1' });
    await client.handlers.interactionCreate(ao);
    assert.deepEqual(ao.respostas, [['reply', { content: '❌ OCORREU UM ERRO AO PROCESSAR ESSA AÇÃO. TENTE NOVAMENTE.', flags: 64 }]]);
    assert.equal(erros.length, 1);

    const adiada = interacao({ customId: 'quebrado:1', deferred: true });
    await client.handlers.interactionCreate(adiada);
    assert.equal(adiada.respostas[0][0], 'editReply');

    const naoResponde = interacao({ customId: 'quebrado:1', isRepliable: () => false });
    await client.handlers.interactionCreate(naoResponde);
    assert.deepEqual(naoResponde.respostas, []);
  });
});
