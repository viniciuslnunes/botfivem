// Casos: cada alerta da inteligência é rastreável. Botões só para a liderança, "resolvido" só depois da
// ação, fechamento único, resolução automática quando a condição some, expiração e métricas de utilidade.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_SSL = 'off';
const { instalarBanco } = require('../tools/banco-em-memoria');
const { criarCanal, criarMembro, criarServidor, criarInteracao } = require('../tools/discord-falso');

const DIA = 24 * 3600 * 1000;
let banco;
let config;
let casos;
let V;
let R;
let interacoes;
let guild;
let canal;
let lider;
let comum;
let alvo;

const textoDe = c => JSON.stringify(c.enviadas.map(m => ({ c: m.content, e: m.embeds })));
const idsDosBotoes = msg => (msg.components ?? []).flatMap(l => (l.components ?? []).map(c => (c.data ?? c).custom_id));
const antes = ms => new Date(Date.now() - ms);

test.before(async () => {
  banco = await instalarBanco();
  config = require('../config/index.js');
  casos = require('../utils/inteligencia/casos');
  V = require('../utils/inteligencia/varredura');
  R = require('../utils/inteligencia/regras');
  interacoes = require('../utils/inteligencia/interacoes');
  canal = criarCanal('CASOS', 'inteligencia');
  lider = criarMembro('LID', { cargos: [config.cargos.diretoria] });
  comum = criarMembro('COMUM', { cargos: [config.cargos.socio] });
  alvo = criarMembro('ALVO', { cargos: [config.cargos.socio], apelido: 'S | Saiu - 100' });
  guild = criarServidor({ id: config.guildId, canais: [canal], membros: [lider, comum, alvo] });
});
test.after(async () => { await banco.pglite.close(); });

const clicar = (customId, membro = lider, extra = {}) => {
  const inter = criarInteracao({ customId, user: membro.user, membro, guild, canal, tipo: 'botao', ...extra });
  inter.client = guild.client;
  return inter;
};

test('alerta sai como caso, com RESOLVIDO/IGNORAR e a ação do tipo; a mensagem fica registrada', async () => {
  const porIdFivem = new Map([['100', { discordId: 'ALVO', membro: alvo }]]);
  const n = await V.alertarSaiuMasSegueSocio(canal, [{ acao: 'saiu_torcida', id: '100', em: antes(DIA) }], porIdFivem);
  assert.equal(n, 1);
  const msg = canal.enviadas.at(-1);
  const ids = idsDosBotoes(msg);
  assert.equal(ids.length, 3);
  assert.ok(ids.some(i => i.startsWith('intel:rem:')) && ids.some(i => i.startsWith('intel:res:')) && ids.some(i => i.startsWith('intel:ign:')));
  const [caso] = await banco.q("SELECT * FROM inteligencia_casos WHERE tipo = 'saiu_segue_socio'");
  assert.equal(caso.status, 'ABERTO');
  assert.equal(caso.alvo_discord_id, 'ALVO');
  assert.equal(caso.message_id, msg.id);
  assert.equal(caso.canal_id, 'CASOS');
});

test('sem o banco o alerta sai igual, sem botões (avisar vale mais que rastrear)', async () => {
  const canalSolto = criarCanal('SOLTO', 'x');
  const db = require('../utils/db');
  const original = db.query;
  const erro = console.error;
  db.query = async () => { throw new Error('banco fora'); };
  console.error = () => {};
  try {
    await casos.enviar(canalSolto, { tipo: 'reincidencia', chave: 'k' }, { content: 'oi', embeds: [{ title: 't' }] });
  } finally { db.query = original; console.error = erro; }
  assert.equal(canalSolto.enviadas.length, 1);
  assert.equal((canalSolto.enviadas[0].components ?? []).length, 0);
});

test('botão de quem não é liderança é recusado e nada muda', async () => {
  const [caso] = await banco.q("SELECT id FROM inteligencia_casos WHERE tipo = 'saiu_segue_socio'");
  const inter = clicar(`intel:res:${caso.id}`, comum);
  await interacoes.tratar(inter);
  assert.match(inter.texto(), /APENAS A LIDERANÇA/);
  assert.equal((await banco.q('SELECT status FROM inteligencia_casos WHERE id = $1', [caso.id]))[0].status, 'ABERTO');
});

test('remover sócio pede confirmação, só resolve depois da ação, e fecha uma vez', async () => {
  const [caso] = await banco.q("SELECT id FROM inteligencia_casos WHERE tipo = 'saiu_segue_socio'");
  const pedido = clicar(`intel:rem:${caso.id}`);
  await interacoes.tratar(pedido);
  assert.ok(alvo.roles.cache.has(config.cargos.socio), 'primeiro clique só pede confirmação');
  assert.equal((await banco.q('SELECT status FROM inteligencia_casos WHERE id = $1', [caso.id]))[0].status, 'ABERTO');

  // o Discord recusa: o caso NÃO pode ficar resolvido
  const removerOriginal = alvo.roles.remove;
  alvo.roles.remove = async () => { throw new Error('Missing Permissions'); };
  const erro = console.error;
  console.error = () => {};
  try {
    await interacoes.tratar(clicar(`intel:remc:${caso.id}`));
  } finally { alvo.roles.remove = removerOriginal; console.error = erro; }
  assert.equal((await banco.q('SELECT status FROM inteligencia_casos WHERE id = $1', [caso.id]))[0].status, 'ABERTO');
  assert.ok(alvo.roles.cache.has(config.cargos.socio));

  await interacoes.tratar(clicar(`intel:remc:${caso.id}`));
  assert.ok(!alvo.roles.cache.has(config.cargos.socio), 'cargo removido');
  const [fechado] = await banco.q('SELECT * FROM inteligencia_casos WHERE id = $1', [caso.id]);
  assert.equal(fechado.status, 'RESOLVIDO');
  assert.equal(fechado.resolvido_por_id, 'LID');
  assert.match(fechado.resolucao, /cargo de sócio removido/);
  const msg = canal.enviadas.find(m => m.id === fechado.message_id);
  assert.equal((msg.components ?? []).length, 0, 'botões saem da mensagem');
  assert.match(JSON.stringify(msg.embeds), /resolvido por/);

  const de_novo = clicar(`intel:remc:${caso.id}`);
  await interacoes.tratar(de_novo);
  assert.match(de_novo.texto(), /JÁ ESTÁ RESOLVIDO/);
});

test('ignorar fecha como IGNORADO; ajustar cargo obedece ao jogo nos dois sentidos', async () => {
  const porIdFivem = new Map([['100', { discordId: 'ALVO', membro: alvo }]]);
  const movimentos = [{ acao: 'promoveu_cargo', alvo_id_fivem: '100', ator_nome: 'Chefe', ocorrido_em: antes(DIA) }];
  await V.alertarCargoDivergente(canal, movimentos, porIdFivem);
  const [c] = await banco.q("SELECT id, dados FROM inteligencia_casos WHERE tipo = 'cargo_divergente'");
  assert.equal(c.dados.promovido, true);
  await interacoes.tratar(clicar(`intel:adj:${c.id}`));
  assert.ok(alvo.roles.cache.has(config.cargos.recrutador), 'promovido no jogo: ganhou o cargo');
  assert.equal((await banco.q('SELECT status FROM inteligencia_casos WHERE id = $1', [c.id]))[0].status, 'RESOLVIDO');

  await V.alertarBlacklistSemBloqueio(canal, [{ id_fivem: '777', em: antes(DIA) }], new Set(), new Map());
  const [b] = await banco.q("SELECT id FROM inteligencia_casos WHERE tipo = 'blacklist_sem_bloqueio'");
  await interacoes.tratar(clicar(`intel:ign:${b.id}`));
  assert.equal((await banco.q('SELECT status FROM inteligencia_casos WHERE id = $1', [b.id]))[0].status, 'IGNORADO');
});

test('botão de bloquear abre o modal com o ID pronto (o bloqueio em si é o fluxo que já existe)', async () => {
  await V.alertarBlacklistSemBloqueio(canal, [{ id_fivem: '888', em: antes(DIA) }], new Set(), new Map());
  const [b] = await banco.q("SELECT id FROM inteligencia_casos WHERE tipo = 'blacklist_sem_bloqueio' AND chave = '888'");
  const inter = clicar(`intel:blq:${b.id}`);
  let modal = null;
  inter.showModal = async m => { modal = m.toJSON ? m.toJSON() : m; };
  await interacoes.tratar(inter);
  assert.equal(modal.custom_id, 'modal_bloquearid');
  const campoId = modal.components[0].components[0];
  assert.equal(campoId.value, '888');
  assert.equal((await banco.q('SELECT status FROM inteligencia_casos WHERE id = $1', [b.id]))[0].status, 'ABERTO', 'só fecha quando o ID entrar na lista');
});

test('resolução automática: cargo saiu, ID bloqueado e ficha decidida fecham sozinhos; o resto segue aberto', async () => {
  // ficha parada + saiu segue + cargo divergente + blacklist já cobertos acima; cria os casos que faltam
  await banco.q(`INSERT INTO fichas_recrutamento (message_id, discord_id, nome, id_fivem, status, criado_em)
                 VALUES ('FP1', 'DX', 'Parada', '55', 'PENDENTE', now() - interval '20 hours'), ('FP2', 'DY', 'Decidida', '56', 'PENDENTE', now() - interval '20 hours')`);
  await V.alertarFichasParadas(canal, [
    { message_id: 'FP1', discord_id: 'DX', nome: 'Parada', id_fivem: '55', status: 'PENDENTE', criado_em: antes(20 * 3600 * 1000) },
    { message_id: 'FP2', discord_id: 'DY', nome: 'Decidida', id_fivem: '56', status: 'PENDENTE', criado_em: antes(20 * 3600 * 1000) },
  ], new Date());
  await banco.q("UPDATE fichas_recrutamento SET status = 'APROVADO' WHERE message_id = 'FP2'");

  const outro = criarMembro('OUTRO', { cargos: [config.cargos.socio], apelido: 'S | Outro - 200' });
  guild.members.cache.set('OUTRO', outro);
  const porIdFivem = new Map([['200', { discordId: 'OUTRO', membro: outro }]]);
  await V.alertarSaiuMasSegueSocio(canal, [{ acao: 'expulso_torcida', id: '200', em: antes(DIA) }], porIdFivem);

  outro.roles.cache.delete(config.cargos.socio); // alguém tirou o cargo por fora
  const pessoas = { guild };
  const resolvidos = await V.resolverCasosAutomaticos(guild.client, { pessoas, idsBloqueados: new Set(['888']) });
  const status = async (tipo, chave) => (await banco.q('SELECT status, resolvido_por_id, resolucao FROM inteligencia_casos WHERE tipo = $1 AND chave = $2', [tipo, chave]))[0];
  assert.equal((await status('ficha_parada', 'FP2')).status, 'RESOLVIDO', 'ficha decidida');
  assert.equal((await status('ficha_parada', 'FP1')).status, 'ABERTO', 'ainda pendente');
  assert.equal((await status('blacklist_sem_bloqueio', '888')).status, 'RESOLVIDO', 'ID entrou em não recrutar');
  const auto = await status('ficha_parada', 'FP2');
  assert.equal(auto.resolvido_por_id, null, 'automático: ninguém assinou');
  assert.match(auto.resolucao, /decidida/);
  assert.ok(resolvidos >= 3);
  const [saiu] = await banco.q("SELECT status FROM inteligencia_casos WHERE tipo = 'saiu_segue_socio' AND alvo_discord_id = 'OUTRO'");
  assert.equal(saiu.status, 'RESOLVIDO', 'o cargo de sócio já saiu');
  assert.equal(await V.resolverCasosAutomaticos(guild.client, { pessoas, idsBloqueados: new Set(['888']) }), 0, 'nada novo a resolver');
});

test('caso aberto há mais de 30 dias expira e a mensagem perde os botões', async () => {
  const c = await casos.abrir({ tipo: 'reincidencia', chave: 'velho', alvoDiscordId: 'X' });
  const msg = await canal.send({ embeds: [{ title: 'velho' }], components: [casos.botoes(c.id)] });
  await casos.registrarMensagem(c.id, canal.id, msg.id);
  await banco.q("UPDATE inteligencia_casos SET aberto_em = now() - interval '40 days' WHERE id = $1", [c.id]);
  const expirados = await casos.expirarAntigos();
  assert.deepEqual(expirados.map(e => e.id), [c.id]);
  await casos.encerrarMensagem(guild.client, expirados[0], 'expirado');
  assert.equal((msg.components ?? []).length, 0);
  assert.equal((await casos.fechar(c.id, 'RESOLVIDO')), null, 'já fechado: não fecha de novo');
});

test('métricas: por tipo, resolução automática, mediana e utilidade dos alertas', async () => {
  const m = await casos.metricas(90);
  const saiu = m.find(x => x.tipo === 'saiu_segue_socio');
  assert.equal(saiu.total, 2);
  assert.equal(saiu.resolvidos, 2);
  assert.equal(saiu.automaticos, 1);
  assert.ok(saiu.mediana_seg >= 0);
  assert.equal(m.find(x => x.tipo === 'blacklist_sem_bloqueio').ignorados, 1);

  const achados = R.avaliarUtilidadeDosAlertas([
    { tipo: 'a', total: 20, abertos: 0, resolvidos: 2, ignorados: 16, expirados: 2, velhos: 0 },
    { tipo: 'b', total: 12, abertos: 2, resolvidos: 3, ignorados: 1, expirados: 6, velhos: 2 },
    { tipo: 'c', total: 4, abertos: 0, resolvidos: 4, ignorados: 0, expirados: 0, velhos: 0 },
  ]);
  assert.deepEqual(achados.filter(a => a.tipo === 'a').map(a => a.gravidade), ['ruido']);
  assert.ok(achados.some(a => a.tipo === 'b' && a.gravidade === 'fila'));
  assert.ok(achados.some(a => a.tipo === 'b' && /ninguém é dono/.test(a.texto)));
  assert.equal(achados.some(a => a.tipo === 'c'), false, 'amostra pequena e tudo resolvido: nada a sugerir');

  const rel = require('../utils/inteligencia/relatorios');
  const embed = await rel.embedCasos();
  assert.match(JSON.stringify(embed), /Saiu e segue sócio/);
  assert.ok(JSON.stringify(embed).length < 6000);
  assert.match(textoDe(canal), /SAIU NO JOGO/);
});
