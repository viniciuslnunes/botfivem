// /setup ponta a ponta com Guild e interação falsos e um tenant injetado: o que
// a liderança vê e o que o bot cria no servidor. Nada toca Discord nem banco.
const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits: P } = require('discord.js');

process.env.DATABASE_URL = 'postgres://teste:teste@127.0.0.1:1/teste';
const dbPath = require.resolve('../utils/db.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => { throw new Error('teste tocou no banco'); } } };

const { executar, confirmarCriacao } = require('../utils/setup/comando');
const { despacharInteracao } = require('../utils/modulos');

function guildDeVerdade({ cargos = [], canais = [], permissoesDoBot = [P.Administrator], posicaoDoBot = 50 } = {}) {
  const criadas = [];
  let n = 0;
  const cache = lista => new Map(lista.map(x => [x.id, x]));
  return {
    criadas,
    roles: {
      cache: cache(cargos),
      everyone: { id: 'EVERYONE' },
      create: async o => { criadas.push(['cargo', o.name]); return { id: `novo-cargo-${++n}` }; },
    },
    channels: {
      cache: cache(canais),
      create: async o => { criadas.push([o.type === 4 ? 'categoria' : 'canal', o.name]); return { id: `novo-canal-${++n}` }; },
    },
    members: { me: { id: 'BOT', permissions: { has: f => permissoesDoBot.includes(f) }, roles: { highest: { position: posicaoDoBot } } } },
  };
}

function interacaoAdmin(guild, extra = {}) {
  const respostas = [];
  return {
    respostas,
    guild,
    member: { permissions: { has: () => true } },
    options: { getSubcommand: () => extra.sub },
    deferReply: async () => {},
    deferUpdate: async () => {},
    editReply: async p => { respostas.push(p); },
    reply: async p => { respostas.push(p); },
    ...extra,
  };
}

// Um tenant novo (quase vazio) que quer os módulos ticket e advertência.
const manifestosDeTeste = [
  { id: 'ticket', descricao: 't', padrao: true, exige: { canais: ['ticket', 'logsTicket'], categorias: ['tickets'] } },
  { id: 'advertencia', descricao: 'a', padrao: true, exige: { canais: ['historicoAdv', 'advPendentes'], cargos: ['adv'] } },
  { id: 'rifas', descricao: 'r', padrao: false, exige: { canais: ['canalDeRifa'] } }, // desligado: nunca cobrado
];
const tenantNovo = {
  slug: 'novo', lideranca: [],
  cargos: { socio: '1' }, canais: {}, categorias: {}, logsJogo: { canais: [] },
};
const plataformaFalsa = { ativos: [{ id: 'setup' }], desligados: [], idsAtivos: new Set(['ticket', 'advertencia']), modoInstalacao: true };
const ctx = { tenant: tenantNovo, plataforma: plataformaFalsa, manifestos: manifestosDeTeste };

test('/setup diagnostico: monta o embed com o resultado (modo instalação: só permissões)', async () => {
  const ruim = interacaoAdmin(guildDeVerdade({ permissoesDoBot: [P.ViewChannel] }), { sub: 'diagnostico' });
  await executar(ruim, ctx);
  const embed = ruim.respostas[0].embeds[0];
  assert.match(embed.title, /SETUP — DIAGNÓSTICO/);
  assert.match(embed.description, /TENANT:\*\* `novo` — \*\*MODO INSTALAÇÃO/);
  assert.match(embed.description, /falta \*\*Enviar mensagens\*\*/);
  assert.match(embed.description, /PROBLEMA\(S\) A RESOLVER/);
  assert.ok(!embed.description.includes('IDS DO TENANT'));

  const ok = interacaoAdmin(guildDeVerdade(), { sub: 'diagnostico' }); // bot administrador
  await executar(ok, ctx);
  assert.match(ok.respostas[0].embeds[0].description, /TUDO CERTO/);
});

test('/setup mapear: acha pelo nome, aponta ambíguo e não achado, e anexa o trecho para colar', async () => {
  const guild = guildDeVerdade({
    cargos: [
      { id: '111', name: '🦅・PRESIDENTE', position: 2 }, { id: '222', name: 'ADV 1', position: 1 },
      { id: '333', name: 'ADV 2', position: 1 }, { id: '444', name: 'ADV 3', position: 1 },
      { id: '555', name: 'Diretor' }, { id: '556', name: 'diretor' },
    ],
    canais: [{ id: '777', name: '🎫・ticket', type: 0, parentId: null }, { id: '888', name: 'TICKETS', type: 4, parentId: null }],
  });
  const i = interacaoAdmin(guild, { sub: 'mapear' });
  await executar(i, ctx);

  const descricao = i.respostas[0].embeds[0].description;
  assert.match(descricao, /cargos\.presidente` → <@&111>/);
  assert.match(descricao, /canais\.ticket` → <#777>/);
  assert.match(descricao, /categorias\.tickets` → <#888>/);
  assert.match(descricao, /AMBÍGUOS \(1\)[\s\S]*cargos\.diretoria/);
  assert.match(descricao, /NÃO ENCONTRADOS[\s\S]*canais\.logsTicket[\s\S]*canais\.historicoAdv/);
  assert.ok(!descricao.includes('canalDeRifa')); // rifas está desligado por padrão: não é cobrado
  assert.ok(!descricao.includes('cargos.socio')); // já mapeado no tenant

  const anexo = i.respostas[0].files[0];
  assert.equal(anexo.name, 'tenant-sugerido.js');
  const texto = anexo.attachment.toString('utf8');
  assert.match(texto, /presidente: '111'/);
  assert.match(texto, /adv: \['222', '333', '444'\]/);
  assert.match(texto, /ticket: '777'/);
});

test('/setup criar: mostra o plano (privado/público) com os botões e não cria nada só por mostrar', async () => {
  const guild = guildDeVerdade({ canais: [{ id: '777', name: 'ticket', type: 0, parentId: null }] });
  const i = interacaoAdmin(guild, { sub: 'criar' });
  await executar(i, ctx);
  const resposta = i.respostas[0];
  const descricao = resposta.embeds[0].description;
  assert.match(descricao, /SERÃO CRIADOS/);
  assert.match(descricao, /categoria \*\*TICKETS\*\*/);
  assert.match(descricao, /canal privado \*\*historico-adv\*\*/);
  assert.ok(!descricao.includes('**ticket**')); // já existe
  assert.deepEqual(resposta.components[0].components.map(b => b.data.custom_id), ['setup:criar:confirmar', 'setup:criar:cancelar']);
  assert.deepEqual(guild.criadas, []);
});

test('/setup criar: com o tenant completo avisa que não há nada a criar', async () => {
  const completo = {
    ...ctx,
    tenant: {
      ...tenantNovo,
      cargos: { socio: '1', presidente: '2', vicePresidente: '3', velhaGuarda: '4', diretoria: '5', recrutador: '6', visitante: '7', provarManto: '8', reprovadoRecrutamento: '9', adv: ['a', 'b', 'c'] },
      canais: { ticket: '1', logsTicket: '2', historicoAdv: '3', advPendentes: '4' },
      categorias: { tickets: '5' },
    },
  };
  const i = interacaoAdmin(guildDeVerdade(), { sub: 'criar' });
  await executar(i, completo);
  assert.match(i.respostas[0].embeds[0].description, /NADA A CRIAR/);
});

test('/setup criar (confirmar): cria no servidor só o que faltava e devolve o trecho com os IDs novos', async () => {
  const guild = guildDeVerdade({ cargos: [{ id: '10', name: 'SÓCIO' }], canais: [{ id: '777', name: 'ticket', type: 0, parentId: null }] });
  const i = interacaoAdmin(guild);
  await confirmarCriacao(i, ctx);

  const nomesCriados = guild.criadas.map(([tipo, nome]) => `${tipo}:${nome}`);
  assert.ok(nomesCriados.includes('categoria:TICKETS'));
  assert.ok(nomesCriados.includes('canal:logs-ticket') && nomesCriados.includes('canal:historico-adv') && nomesCriados.includes('canal:adv-pendentes'));
  assert.ok(nomesCriados.includes('cargo:ADV 1') && nomesCriados.includes('cargo:ADV 3') && nomesCriados.includes('cargo:PRESIDENTE'));
  assert.ok(!nomesCriados.includes('canal:ticket') && !nomesCriados.includes('cargo:SÓCIO')); // já existiam

  const resposta = i.respostas[0];
  assert.match(resposta.embeds[0].description, /ITEM\(NS\) CRIADO\(S\)/);
  assert.deepEqual(resposta.components, []);
  assert.equal(resposta.files[0].name, 'tenant-criado.js');
  const texto = resposta.files[0].attachment.toString('utf8');
  assert.match(texto, /presidente: 'novo-cargo-\d+'/);
  assert.match(texto, /adv: \['novo-cargo-\d+', 'novo-cargo-\d+', 'novo-cargo-\d+'\]/);
});

test('botão de confirmar (tenant real, já completo): responde e não cria nada', async () => {
  const guild = guildDeVerdade();
  const i = interacaoAdmin(guild, { customId: 'setup:criar:confirmar' });
  assert.equal(await despacharInteracao(i), true);
  assert.deepEqual(guild.criadas, []);
  assert.match(i.respostas[0].embeds[0].description, /0 ITEM\(NS\) CRIADO\(S\)/);
});
