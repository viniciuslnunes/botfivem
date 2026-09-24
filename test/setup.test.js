// Onboarding (/setup, novo-tenant, /status). Lógica pura com servidor falso;
// nada toca Discord nem banco.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PermissionFlagsBits: P } = require('discord.js');

process.env.DATABASE_URL = 'postgres://teste:teste@127.0.0.1:1/teste';
const dbPath = require.resolve('../utils/db.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => { throw new Error('teste tocou no banco'); } } };

const { normalizar } = require('../utils/setup/catalogo');
const { pontuar, sugerirMapeamento, chavesFaltando } = require('../utils/setup/mapeamento');
const { gerarSnippet } = require('../utils/setup/snippet');
const D = require('../utils/setup/diagnostico');
const { planejarCriacao, executarCriacao } = require('../utils/setup/criar');
const { gerarTenantEsqueleto, validarEntrada, siglaDe } = require('../utils/setup/esqueleto');
const { criar } = require('../tools/novo-tenant');
const { carregarTenant } = require('../config/carregar');
const { criarTema } = require('../tema/criar');
const { montarStatus, duracao } = require('../utils/status');

// ── Nomes ────────────────────────────────────────────────────────────────────
test('normalizar: sem acento, emoji nem pontuação', () => {
  assert.equal(normalizar('🦅・Sócios'), 'socios');
  assert.equal(normalizar('VICE-PRESIDENTE'), 'vice presidente');
  assert.equal(normalizar('  Histórico__ADV  '), 'historico adv');
  assert.equal(normalizar(null), '');
});

test('pontuar: igual > começa/termina > contém; nome que só contém pedaço da palavra não casa', () => {
  assert.equal(pontuar('socio', ['socio']), 100);
  assert.equal(pontuar('socio oficial', ['socio']), 60);
  assert.equal(pontuar('gdf socio', ['socio']), 60);
  assert.equal(pontuar('a socio b', ['socio']), 40);
  assert.equal(pontuar('sociologia', ['socio']), 0);
  assert.equal(pontuar('outro', ['socio']), 0);
});

// ── Mapeamento ───────────────────────────────────────────────────────────────
const servidor = {
  roles: [
    { id: '1', name: '🦅・SÓCIO', position: 5 }, { id: '2', name: 'PRESIDENTE', position: 9 },
    { id: '3', name: 'Vice-Presidente', position: 8 }, { id: '4', name: 'ADV 1', position: 2 },
    { id: '5', name: 'ADV 2', position: 2 }, { id: '6', name: 'ADV 3', position: 2 },
    { id: '7', name: 'Diretoria', position: 7 }, { id: '8', name: 'Diretoria Geral', position: 7 },
    { id: '9', name: 'Visitante', position: 1 },
  ],
  channels: [
    { id: 'c1', name: '🎫・ticket', type: 0, parentId: null }, { id: 'c2', name: 'recrutamento', type: 0, parentId: null },
    { id: 'c3', name: 'historico-adv', type: 0, parentId: null }, { id: 'k1', name: 'TICKETS', type: 4, parentId: null },
    { id: 'c4', name: 'logs-ticket', type: 0, parentId: 'k1' }, { id: 'v1', name: 'geral', type: 2, parentId: null },
  ],
};

test('sugerirMapeamento: acha por nome, lista adv por posição, categoria só entre categorias, canal só entre canais de texto', () => {
  const r = sugerirMapeamento(servidor, {
    cargos: ['socio', 'presidente', 'vicePresidente', 'velhaGuarda', 'visitante'],
    cargosEmLista: { adv: 3 },
    canais: ['ticket', 'recrutamento', 'historicoAdv', 'logsTicket', 'validarId'],
    categorias: ['tickets'],
  });
  assert.deepEqual(r.cargos, { socio: '1', presidente: '2', vicePresidente: '3', visitante: '9', adv: ['4', '5', '6'] });
  assert.deepEqual(r.canais, { ticket: 'c1', recrutamento: 'c2', historicoAdv: 'c3', logsTicket: 'c4' });
  assert.deepEqual(r.categorias, { tickets: 'k1' });
  assert.deepEqual(r.semCorrespondencia.sort(), ['canais.validarId', 'cargos.velhaGuarda']);
  assert.deepEqual(r.ambiguos, []);
});

test('sugerirMapeamento: empate no topo vira ambíguo (não chuta) e o mesmo cargo não serve a duas chaves', () => {
  const r = sugerirMapeamento(
    { roles: [{ id: 'a', name: 'diretor' }, { id: 'b', name: 'Diretor' }, { id: 'c', name: 'socio' }], channels: [] },
    { cargos: ['diretoria', 'socio'] },
  );
  assert.equal(r.ambiguos.length, 1);
  assert.equal(r.ambiguos[0].chave, 'cargos.diretoria');
  assert.deepEqual(r.ambiguos[0].opcoes.sort(), ['Diretor', 'diretor']);
  assert.deepEqual(r.cargos, { socio: 'c' });

  // um único cargo "recrutador" não pode ser sugerido para recrutador E para outra chave parecida
  const r2 = sugerirMapeamento({ roles: [{ id: 'x', name: 'Recrutador' }], channels: [] }, { cargos: ['recrutador', 'recrutador'] });
  assert.equal(Object.keys(r2.cargos).length, 1);
  assert.equal(r2.semCorrespondencia.length, 1);
});

test('sugerirMapeamento: adv incompleto (falta o ADV 3) não vira lista pela metade', () => {
  const r = sugerirMapeamento({ roles: [{ id: '1', name: 'ADV 1' }, { id: '2', name: 'ADV 2' }], channels: [] }, { cargosEmLista: { adv: 3 } });
  assert.equal(r.cargos.adv, undefined);
  assert.deepEqual(r.semCorrespondencia, ['cargos.adv[3]']);
});

test('chavesFaltando: junta o essencial de toda torcida com o que os módulos LIGADOS exigem', () => {
  const modulos = [
    { id: 'ticket', exige: { canais: ['ticket', 'logsTicket'], categorias: ['tickets'] } },
    { id: 'advertencia', exige: { canais: ['historicoAdv'], cargos: ['adv'] } },
  ];
  const tenant = { cargos: { socio: '1', presidente: '2', adv: ['a', 'b', 'c'] }, canais: { ticket: 'c1' }, categorias: {} };
  const f = chavesFaltando(modulos, tenant);
  assert.deepEqual(f.canais.sort(), ['historicoAdv', 'logsTicket']);
  assert.deepEqual(f.categorias, ['tickets']);
  assert.ok(f.cargos.includes('vicePresidente') && !f.cargos.includes('socio') && !f.cargos.includes('presidente'));
  assert.deepEqual(f.cargosEmLista, {}); // adv já tem os 3

  assert.deepEqual(chavesFaltando(modulos, { cargos: { adv: ['a'] } }).cargosEmLista, { adv: 3 });
});

test('gerarSnippet: blocos só com o que existe; lista de cargos entre colchetes', () => {
  const s = gerarSnippet({ cargos: { socio: '1', adv: ['4', '5', '6'] }, canais: { ticket: 'c1' }, categorias: {} });
  assert.match(s, /cargos: \{\n {4}socio: '1',\n {4}adv: \['4', '5', '6'\],\n {2}\},/);
  assert.match(s, /canais: \{\n {4}ticket: 'c1',\n {2}\},/);
  assert.ok(!s.includes('categorias'));
  assert.match(gerarSnippet({ cargos: {} }), /Nada a acrescentar/);
});

// ── Diagnóstico ──────────────────────────────────────────────────────────────
const permissoes = flags => ({ has: f => flags.includes(f) });

test('avaliarPermissoes: só cobra o que os módulos ligados usam; Administrador cobre tudo', () => {
  const base = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory];
  const semAntiSpam = D.avaliarPermissoes(permissoes(base), new Set(['logsJogo']));
  // logsJogo cria canais de painel e ajusta apelido (associar ID ao sócio)
  assert.deepEqual(semAntiSpam.filter(p => !p.ok).map(p => p.permissao).sort(), ['Gerenciar apelidos', 'Gerenciar canais']);

  const comAntiSpam = D.avaliarPermissoes(permissoes(base), new Set(['antiSpam']));
  assert.deepEqual(comAntiSpam.filter(p => !p.ok).map(p => p.permissao).sort(), ['Banir membros', 'Gerenciar mensagens', 'Silenciar membros (castigo)']);

  assert.ok(D.avaliarPermissoes(permissoes([P.Administrator]), new Set(['antiSpam', 'logsJogo', 'recrutamento'])).every(p => p.ok));
  assert.ok(D.avaliarPermissoes(permissoes([]), new Set()).every(p => !p.ok)); // só as básicas, todas faltando
});

test('avaliarPosicaoDoCargoDoBot: cargo igual ou acima do bot é problema', () => {
  const r = D.avaliarPosicaoDoCargoDoBot(5, [{ id: '1', name: 'A', position: 4 }, { id: '2', name: 'B', position: 5 }, { id: '3', name: 'C', position: 9 }]);
  assert.deepEqual(r.map(x => x.cargo), ['B', 'C']);
});

test('avaliarIdsDoTenant: inexistente, tipo trocado (canal usado como cargo) e null ignorado', () => {
  const srv = { roles: [{ id: '10', name: 'r' }], channels: [{ id: '20', name: 'c', type: 0 }, { id: '30', name: 'cat', type: 4 }] };
  const tenant = {
    cargos: { socio: '10', diretoria: '20', presidente: '999', adv: ['10', '11'], elenco: null },
    canais: { ticket: '20', hierarquia: '10' }, categorias: { tickets: '30' },
    lideranca: ['10'], hierarquia: [{ id: '10' }], departamentos: [{ canalId: null }, { canalId: '77' }],
    logsJogo: { canais: ['20'], categoriaLogs: '30', canalAlertas: null },
  };
  const r = D.avaliarIdsDoTenant(tenant, srv);
  const por = Object.fromEntries(r.map(p => [p.caminho, p.problema]));
  assert.equal(por['cargos.diretoria'], 'é um canal, não um cargo');
  assert.equal(por['cargos.presidente'], 'não existe neste servidor');
  assert.equal(por['cargos.adv[1]'], 'não existe neste servidor');
  assert.equal(por['canais.hierarquia'], 'é um cargo, não um canal');
  assert.equal(por['departamentos[1].canalId'], 'não existe neste servidor');
  assert.ok(!('cargos.elenco' in por) && !('canais.ticket' in por) && !('cargos.socio' in por));
  assert.equal(r.length, 5);
});

test('avaliarCanaisDeLog: canal fora da categoria de logs é apontado (a contaminação de 2026-09-13)', () => {
  const srv = { channels: [{ id: 'a', name: 'logs-painel', parentId: 'CAT' }, { id: 'b', name: 'logs-outra-comunidade', parentId: 'OUTRA' }] };
  const r = D.avaliarCanaisDeLog({ logsJogo: { canais: ['a', 'b', 'inexistente'], categoriaLogs: 'CAT' } }, srv);
  assert.deepEqual(r.map(x => x.canal), ['logs-outra-comunidade']);
});

test('montarDiagnostico: em modo instalação só permissões; no normal, tudo — e conta os problemas', () => {
  const plataforma = { ativos: [{ id: 'logsJogo' }], desligados: [{ id: 'rifas' }], idsAtivos: new Set(['logsJogo']), modoInstalacao: false };
  const srv = { roles: [{ id: '1', name: 'SÓCIO', position: 9 }], channels: [] };
  const tenant = { slug: 't', cargos: { socio: '1', adv: [] }, canais: {}, categorias: {}, logsJogo: { canais: [] } };
  const r = D.montarDiagnostico({ tenant, plataforma, servidor: srv, permissoesDoBot: permissoes([]), posicaoDoBot: 3 });
  const texto = r.linhas.join('\n');
  assert.ok(texto.includes('MÓDULOS LIGADOS (1)') && texto.includes('DESLIGADOS (1)'));
  assert.ok(texto.includes('falta **Gerenciar canais**'));
  assert.ok(texto.includes('o cargo **SÓCIO** está no mesmo nível ou acima'));
  assert.ok(r.problemas >= 7);

  const inst = D.montarDiagnostico({ tenant, plataforma: { ...plataforma, modoInstalacao: true }, servidor: srv, permissoesDoBot: permissoes([P.Administrator]), posicaoDoBot: 3 });
  assert.equal(inst.problemas, 0);
  assert.ok(inst.linhas.join('\n').includes('MODO INSTALAÇÃO'));
  assert.ok(!inst.linhas.join('\n').includes('IDS DO TENANT'));
});

// ── Criação ──────────────────────────────────────────────────────────────────
test('planejarCriacao: cargos, depois categorias, depois canais; privado por padrão, público conforme o catálogo', () => {
  const plano = planejarCriacao(['canais.ticket', 'canais.historicoAdv', 'cargos.socio', 'categorias.tickets', 'cargos.adv[2]', 'lixo']);
  assert.deepEqual(plano.map(p => p.tipo), ['cargo', 'cargo', 'categoria', 'canal', 'canal']);
  assert.deepEqual(plano.find(p => p.chave === 'adv[2]'), { tipo: 'cargo', chave: 'adv[2]', lista: 'adv', indice: 2, nome: 'ADV 2' });
  assert.equal(plano.find(p => p.chave === 'ticket').publico, true);
  assert.equal(plano.find(p => p.chave === 'historicoAdv').publico, false);
  assert.equal(plano.find(p => p.chave === 'socio').nome, 'SÓCIO');
});

function guildFalso({ falharEm } = {}) {
  const chamadas = [];
  let n = 0;
  const criar = tipo => async opcoes => {
    if (falharEm && opcoes.name === falharEm) throw new Error('sem permissão');
    chamadas.push([tipo, opcoes]);
    return { id: `${tipo}${++n}` };
  };
  return {
    chamadas,
    roles: { create: criar('cargo'), everyone: { id: 'EVERYONE' } },
    channels: { create: criar('canal') },
    members: { me: { id: 'BOT' } },
  };
}

test('executarCriacao: canal privado nega @everyone e libera bot e liderança (inclusive a criada agora); público sem restrição', async () => {
  const guild = guildFalso();
  const plano = planejarCriacao(['cargos.presidente', 'cargos.socio', 'categorias.tickets', 'canais.ticket', 'canais.historicoAdv']);
  const { criados, falhas } = await executarCriacao(guild, plano, { lideranca: ['LIDER_EXISTENTE'] });
  assert.deepEqual(falhas, []);
  assert.deepEqual(Object.keys(criados.cargos).sort(), ['presidente', 'socio']);
  assert.ok(criados.categorias.tickets && criados.canais.ticket && criados.canais.historicoAdv);

  const privado = guild.chamadas.find(([, o]) => o.name === 'historico-adv')[1];
  const ids = privado.permissionOverwrites.map(p => p.id);
  assert.ok(ids.includes('EVERYONE') && ids.includes('BOT') && ids.includes('LIDER_EXISTENTE') && ids.includes(criados.cargos.presidente));
  assert.ok(!ids.includes(criados.cargos.socio)); // sócio comum não vê canal privado
  assert.deepEqual(privado.permissionOverwrites.find(p => p.id === 'EVERYONE').deny, [P.ViewChannel]);

  const publico = guild.chamadas.find(([, o]) => o.name === 'ticket')[1];
  assert.deepEqual(publico.permissionOverwrites, []);
});

test('executarCriacao: uma falha não interrompe o resto e é reportada; lista de ADV mantém a posição', async () => {
  const guild = guildFalso({ falharEm: 'ADV 2' });
  const plano = planejarCriacao(['cargos.adv[1]', 'cargos.adv[2]', 'cargos.adv[3]', 'canais.ticket']);
  const { criados, falhas } = await executarCriacao(guild, plano);
  assert.equal(falhas.length, 1);
  assert.match(falhas[0], /cargo ADV 2: sem permissão/);
  assert.ok(criados.canais.ticket);
  assert.equal(criados.cargos.adv[0] !== undefined && criados.cargos.adv[2] !== undefined && criados.cargos.adv[1] === undefined, true);
});

// ── Esqueleto e novo-tenant ──────────────────────────────────────────────────
test('validarEntrada: lista todos os problemas do comando novo-tenant', () => {
  const erros = validarEntrada({ slug: 'Mancha Verde!', guildId: '123', nome: 'x', fonte: undefined });
  assert.equal(erros.length, 4);
  assert.ok(validarEntrada({ slug: '_exemplo2', guildId: '100000000000000001', nome: 'Torcida', fonte: 'x' }).some(e => e.includes('começar com "_"')));
  assert.deepEqual(validarEntrada({ slug: 'mancha', guildId: '100000000000000001', nome: 'Mancha Verde', fonte: 'hoolibras' }), []);
});

test('siglaDe: iniciais do nome', () => {
  assert.equal(siglaDe('Mancha Verde'), 'MV');
  assert.equal(siglaDe('Gaviões da Fiel'), 'GDF');
});

test('esqueleto gerado carrega e valida: tenant (modo instalação) passa no schema e o tema passa na validação', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'novo-tenant-'));
  const pasta = criar({ slug: 'mancha-verde', guild: '100000000000000123', nome: 'Mancha Verde' }, raiz);

  const tenant = carregarTenant('mancha-verde', { raiz });
  assert.equal(tenant.instalacao, true);
  assert.equal(tenant.jogo.fonte, 'hoolibras');

  const tema = criarTema(require(path.join(pasta, 'tema.js')), { pastaAssets: path.join(pasta, 'assets') });
  assert.equal(tema.marca.nome, 'MANCHA VERDE FIVEM');
  assert.equal(tema.marca.nickPrefixo, 'S MV | ');
  assert.equal(tema.titulo('BAÚ'), 'BAÚ — MANCHA VERDE FIVEM');
  for (const arq of ['logo.png', 'capa.png', 'faixa.png']) assert.ok(fs.existsSync(tema.asset(arq)), arq);
});

test('novo-tenant recusa pasta existente sem alterar nada e recusa entrada inválida', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'novo-tenant-'));
  criar({ slug: 'a', guild: '100000000000000123', nome: 'Torcida A' }, raiz);
  const antes = fs.readFileSync(path.join(raiz, 'a', 'tenant.js'), 'utf8');
  assert.throws(() => criar({ slug: 'a', guild: '100000000000000999', nome: 'Outra' }, raiz), /já existe/);
  assert.equal(fs.readFileSync(path.join(raiz, 'a', 'tenant.js'), 'utf8'), antes);
  assert.throws(() => criar({ slug: 'B!', guild: '1', nome: '' }, raiz), /slug inválido/);
  assert.ok(!fs.existsSync(path.join(raiz, 'B!')));
});

test('gerarTenantEsqueleto: o texto gerado nunca traz `instalacao` fora do tenant.js nem placeholder de ID', () => {
  const arquivos = gerarTenantEsqueleto({ slug: 'x', guildId: '100000000000000123', nome: 'Torcida X', fonte: 'hoolibras' });
  assert.deepEqual(Object.keys(arquivos).sort(), ['tema.js', 'tenant.js']);
  assert.ok(!arquivos['tema.js'].includes('instalacao'));
});

// ── /status ──────────────────────────────────────────────────────────────────
test('duracao: dias, horas, minutos', () => {
  assert.equal(duracao(30 * 60 * 1000), '30min');
  assert.equal(duracao((3 * 60 + 5) * 60 * 1000), '3h 5min');
  assert.equal(duracao((2 * 24 + 7) * 3600 * 1000), '2d 7h');
  assert.equal(duracao(-5), '0min');
});

test('montarStatus: tudo em dia não tem problema; banco fora, tarefa desistente e log parado/nunca contam', () => {
  const agora = Date.parse('2026-09-24T12:00:00Z');
  const plataforma = { ativos: [{}, {}], desligados: [{}] };
  const base = { tenant: { slug: 't' }, plataforma, uptimeSeg: 7200, versao: '1.2.3', agora, fonteParadaDias: 3 };

  const ok = montarStatus({ ...base, banco: { ok: true, ms: 4 }, tarefas: { pendente: 2, executando: 0 }, logs: [{ nome: 'logs-painel', ultima: '2026-09-24T11:00:00Z' }] });
  assert.equal(ok.problemas, 0);
  const textoOk = ok.linhas.join('\n');
  assert.ok(textoOk.includes('2 ligados, 1 desligados') && textoOk.includes('respondendo (4 ms)') && textoOk.includes('último log há 1h 0min'));

  const ruim = montarStatus({
    ...base, banco: { ok: false, erro: 'timeout' }, tarefas: { pendente: 0, executando: 0, erro: 3 },
    logs: [{ nome: 'a', ultima: '2026-09-10T00:00:00Z' }, { nome: 'b', ultima: null }],
  });
  assert.equal(ruim.problemas, 4);
  const t = ruim.linhas.join('\n');
  assert.ok(t.includes('sem resposta — timeout') && t.includes('3 tarefa(s) desistiram') && t.includes('#a — parado há') && t.includes('#b — nunca recebeu log'));

  const semLogs = montarStatus({ ...base, banco: { ok: true, ms: 1 }, tarefas: null, logs: null });
  assert.ok(!semLogs.linhas.join('\n').includes('FONTES DE LOG'));
  assert.ok(semLogs.linhas.join('\n').includes('indisponível'));
});

// ── /setup: permissão e botões ───────────────────────────────────────────────
test('/setup: só administrador (comando e botão de confirmar)', async () => {
  const { executar, SUBCOMANDOS } = require('../utils/setup/comando');
  assert.deepEqual(Object.keys(SUBCOMANDOS).sort(), ['criar', 'diagnostico', 'mapear']);

  const respostas = [];
  const naoAdmin = { member: { permissions: { has: () => false } }, reply: async p => { respostas.push(p); } };
  await executar(naoAdmin);
  assert.match(respostas[0].content, /APENAS ADMINISTRADORES/);
  assert.equal(respostas[0].flags, 64);

  const { despacharInteracao } = require('../utils/modulos');
  respostas.length = 0;
  const botaoNaoAdmin = { customId: 'setup:criar:confirmar', member: { permissions: { has: () => false } }, reply: async p => { respostas.push(p); } };
  assert.equal(await despacharInteracao(botaoNaoAdmin), true);
  assert.match(respostas[0].content, /APENAS ADMINISTRADORES/);

  const atualizacoes = [];
  const cancelar = { customId: 'setup:criar:cancelar', member: { permissions: { has: () => true } }, update: async p => { atualizacoes.push(p); } };
  await despacharInteracao(cancelar);
  assert.match(atualizacoes[0].embeds[0].description, /Cancelado\. Nada foi criado/);
  assert.deepEqual(atualizacoes[0].components, []);
});
