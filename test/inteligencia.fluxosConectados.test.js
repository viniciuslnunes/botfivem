// Fluxos que se conversam: barramento de eventos, acompanhamento do recém-aprovado (tarefas do
// agendador), ADV manual com registro, ticket com contexto, triagem da ficha, enriquecimento da ficha
// do associado e os alertas de divergência entre jogo e Discord. PGlite + Discord falso; nada real.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_SSL = 'off';
const { instalarBanco } = require('../tools/banco-em-memoria');
const { criarCanal, criarMembro, criarServidor, criarMensagem } = require('../tools/discord-falso');

const HORA = 3600 * 1000;
const DIA = 24 * HORA;
let banco;
let config;
let repo;
let F;
let V;
let guild;
let canalInt;
let contador = 0;

const antes = ms => new Date(Date.now() - ms);
const textoDe = canal => JSON.stringify(canal.enviadas.map(m => ({ c: m.content, e: m.embeds })));

async function log({ acao, ator = null, alvo = null, atorNome = null, alvoNome = null, valor = null, quando = antes(HORA), descricao = null }) {
  contador++;
  await banco.q(
    `INSERT INTO logs_jogo (message_id, embed_indice, canal_id, categoria, acao, ator_nome, ator_id_fivem, alvo_nome, alvo_id_fivem, valor, descricao, ocorrido_em, bruto)
     VALUES ($1, 0, 'c', 'x', $2, $3, $4, $5, $6, $7, $8, $9, '{}'::jsonb)`,
    [String(70000 + contador), acao, atorNome, ator, alvoNome, alvo, valor, descricao, quando]
  );
}
const ficha = (msg, disc, idf, status, decididoPor, criado, decidido) => banco.q(
  `INSERT INTO fichas_recrutamento (message_id, discord_id, nome, id_fivem, status, decidido_por_id, criado_em, decidido_em)
   VALUES ($1, $2, 'Candidato Teste', $3, $4, $5, $6, $7)`, [msg, disc, idf, status, decididoPor, criado, decidido]);

test.before(async () => {
  banco = await instalarBanco();
  config = require('../config/index.js');
  repo = require('../utils/inteligencia/repositorio');
  F = require('../utils/inteligencia/fluxos');
  V = require('../utils/inteligencia/varredura');
  canalInt = criarCanal('INT', 'inteligencia');
  const validar = criarCanal(config.canais.validarSetagem, 'validar-setagem');
  const rec = criarMembro('REC1', { cargos: [config.cargos.socio, config.cargos.recrutador], apelido: 'R | Rec - 55' });
  const socio = criarMembro('S1', { cargos: [config.cargos.socio], apelido: 'S | Zeca - 100' });
  socio.joinedTimestamp = Date.now() - 200 * DIA;
  guild = criarServidor({ id: config.guildId, canais: [canalInt, validar], membros: [rec, socio] });
  await banco.q("INSERT INTO bot_config (key, value) VALUES ('canal_inteligencia', 'INT')"); // o canal já existe: não cria outro
});
test.after(async () => { await banco.pglite.close(); });

test('barramento: assinante roda, erro de um não derruba os outros, e limpar esquece', async () => {
  const b = require('../utils/barramento');
  const vistos = [];
  const erro = console.error;
  console.error = () => {};
  try {
    b.assinar('teste.evento', async () => { throw new Error('x'); });
    b.assinar('teste.evento', async p => { vistos.push(p.n); });
    await b.emitir('teste.evento', { n: 1 });
  } finally { console.error = erro; }
  assert.deepEqual(vistos, [1]);
  b.limpar('teste.evento');
  await b.emitir('teste.evento', { n: 2 });
  assert.deepEqual(vistos, [1]);
});

test('enriquecedores: campos vêm dos módulos registrados e erro não derruba o embed', async () => {
  const en = require('../utils/enriquecedores');
  const erro = console.error;
  console.error = () => {};
  try {
    en.registrar('ponto.teste', async () => { throw new Error('quebrou'); });
    en.registrar('ponto.teste', async () => ({ name: 'A', value: 'a' }));
    en.registrar('ponto.teste', async () => [{ name: 'B', value: 'b' }, { name: 'C', value: 'c' }]);
    en.registrar('ponto.teste', async () => null);
    assert.deepEqual((await en.coletar('ponto.teste', {})).map(c => c.name), ['A', 'B', 'C']);
  } finally { console.error = erro; }
  assert.deepEqual(await en.coletar('ponto.inexistente', {}), []);
});

test('ficha aprovada agenda 3 acompanhamentos; reprovada não agenda nada', async () => {
  await F.aoFichaDecidida({ status: 'REPROVADO', fichaId: 'x1' });
  assert.equal((await banco.q("SELECT 1 FROM tarefas_agendadas WHERE tipo = 'inteligencia_acompanhamento'")).length, 0);
  await F.aoFichaDecidida({ status: 'APROVADO', fichaId: 'x2' });
  const tarefas = await banco.q("SELECT payload FROM tarefas_agendadas WHERE tipo = 'inteligencia_acompanhamento' ORDER BY executar_em");
  assert.deepEqual(tarefas.map(t => t.payload.etapa), ['setagem', 'aparecer', 'semana']);
});

test('acompanhamento: setagem cobra quem não foi setado e some quando o jogo registra', async () => {
  await ficha('FA', 'DA', '900', 'APROVADO', 'REC1', antes(30 * HORA), antes(29 * HORA));
  const r = await F.acompanhar(guild.client, { fichaId: 'FA', etapa: 'setagem' });
  assert.equal(r, 'avisada');
  const txt = textoDe(canalInt);
  assert.match(txt, /AINDA NÃO SETADO NO JOGO/);
  assert.match(txt, /<@REC1>/, 'o aprovador é chamado');
  assert.equal(canalInt.enviadas.at(-1).content, '<@REC1>');

  await log({ acao: 'jogador_recrutou', ator: '55', alvo: '900', alvoNome: 'Candidato', quando: antes(20 * HORA) });
  const antesDeAvisos = canalInt.enviadas.length;
  assert.equal(await F.acompanhar(guild.client, { fichaId: 'FA', etapa: 'setagem' }), 'ok');
  assert.equal(canalInt.enviadas.length, antesDeAvisos, 'já setado: sem aviso');
});

test('acompanhamento: quem não aparece é cobrado; na semana, ativo ganha sinal de confiança', async () => {
  await ficha('FB', 'DB', '901', 'APROVADO', 'REC1', antes(8 * DIA), antes(8 * DIA - HORA));
  assert.equal(await F.acompanhar(guild.client, { fichaId: 'FB', etapa: 'aparecer' }), 'avisada');
  assert.match(textoDe(canalInt), /NÃO APARECEU NO JOGO/);
  assert.equal(await F.acompanhar(guild.client, { fichaId: 'FB', etapa: 'semana' }), 'avisada');
  assert.match(textoDe(canalInt), /SEM JOGAR NA PRIMEIRA SEMANA/);

  await ficha('FC', 'DC', '902', 'APROVADO', 'REC1', antes(8 * DIA), antes(8 * DIA - HORA));
  await log({ acao: 'jogador_entrou', ator: '902', quando: antes(2 * DIA) });
  assert.equal(await F.acompanhar(guild.client, { fichaId: 'FC', etapa: 'aparecer' }), 'ok');
  assert.equal(await F.acompanhar(guild.client, { fichaId: 'FC', etapa: 'semana' }), 'ativo');
  const eventos = await banco.q("SELECT sinal FROM confianca_eventos WHERE discord_id = 'DC'");
  assert.deepEqual(eventos.map(e => e.sinal), ['NOVATO_ATIVO']);
  assert.equal(await F.acompanhar(guild.client, { fichaId: 'FC', etapa: 'semana' }), 'ativo', 'repetir não pontua de novo');
  assert.equal((await banco.q("SELECT 1 FROM confianca_eventos WHERE discord_id = 'DC'")).length, 1);
});

test('acompanhamento: decisão desfeita no meio do caminho cancela tudo', async () => {
  await ficha('FD', 'DD', '903', 'PENDENTE', null, antes(30 * HORA), null);
  const n = canalInt.enviadas.length;
  assert.equal(await F.acompanhar(guild.client, { fichaId: 'FD', etapa: 'setagem' }), 'ignorada');
  assert.equal(await F.acompanhar(guild.client, { fichaId: 'NAO_EXISTE', etapa: 'setagem' }), 'ignorada');
  assert.equal(canalInt.enviadas.length, n);
});

test('ADV manual passa a deixar registro, sem entrar no fluxo de pagamento, e a remoção encerra', async () => {
  const A = require('../utils/advertencia/repositorio');
  const linha = await A.inserir({
    discordId: 'S1', idFivem: '100', nivel: 2, origem: 'manual', motivo: 'briga', registradoPor: 'LID1',
    logMessageId: 'manual:S1:1', status: 'ATIVA',
  });
  assert.equal(linha.origem, 'manual');
  assert.deepEqual(await A.pendentes('S1'), [], 'manual não tem prazo: não aparece como pagamento pendente');
  assert.deepEqual(await A.pendentesDePagamento('100'), []);
  const ativas = await repo.advSocioAtivas();
  assert.equal(ativas.find(a => a.discord_id === 'S1').ativas, 1);

  const encerrada = await A.encerrarManualMaisRecente('S1', 'REMOVIDA', 'perdoado');
  assert.equal(encerrada.status, 'REMOVIDA');
  assert.equal(await A.encerrarManualMaisRecente('S1', 'REMOVIDA', 'de novo'), null, 'nada mais a encerrar');
});

test('ADV registrada: resumo, confiança e reincidência atualizam na hora', async () => {
  const A = require('../utils/advertencia/repositorio');
  const membro = guild.members.cache.get('S1');
  await log({ acao: 'impedimento_adicionou', ator: '1', alvo: '100', alvoNome: 'Zeca', quando: antes(3 * DIA) });
  const linha = await A.inserir({
    discordId: 'S1', idFivem: '100', nivel: 1, origem: 'manual', motivo: 'atraso', registradoPor: 'LID1',
    logMessageId: 'manual:S1:2', status: 'ATIVA',
  });
  membro.roles.cache.set(config.cargos.adv[0], { id: config.cargos.adv[0] });
  const atencao = criarCanal(config.canais.ocorrencias, 'ocorrencias');
  guild.channels.cache.set(atencao.id, atencao);

  await F.aoAdvRegistrada({ client: guild.client, membro, nivel: 1, origem: 'manual', advId: linha.id });
  const resumo = await repo.resumoDe('S1');
  assert.equal(resumo.dados.advAtivas, 1, 'o cargo ADV é a fonte da verdade');
  assert.ok(resumo.risco >= 20);
  const sinais = await banco.q("SELECT sinal, peso FROM confianca_eventos WHERE discord_id = 'S1'");
  assert.ok(sinais.some(s => s.sinal === 'ADV_SOCIO' && s.peso < 0));
  // ADV + impedimento recente = 2 ocorrências em 90 dias: reincidente, avisado na hora
  assert.match(textoDe(atencao), /SÓCIO REINCIDENTE/);

  await F.aoAdvRegistrada({ client: guild.client, membro, nivel: 1, origem: 'manual', advId: linha.id });
  assert.equal(atencao.enviadas.length, 1, 'mesma contagem: não repete o aviso');
  membro.roles.cache.delete(config.cargos.adv[0]);
  await A.encerrarManualMaisRecente('S1', 'REMOVIDA', 'perdoado'); // o que o botão de remover faz
  await F.aoAdvRemovida({ client: guild.client, membro, nivel: 1 });
  assert.equal((await repo.resumoDe('S1')).dados.advAtivas, 0);
});

test('ticket de recrutamento recebe o contexto da ficha do candidato', async () => {
  await ficha('FT', 'DT', '910', 'REPROVADO', 'REC1', antes(5 * DIA), antes(5 * DIA - HORA));
  await banco.q("UPDATE fichas_recrutamento SET reprovado_categoria = 'menor de idade', permite_reenvio = false WHERE message_id = 'FT'");
  const canal = criarCanal('TK1', 'ticket-x');
  await F.aoTicketAberto({ canal, categoria: 'recrutamento', usuario: { id: 'DT' } });
  const txt = textoDe(canal);
  assert.match(txt, /CONTEXTO DO CANDIDATO/);
  assert.match(txt, /reprovada/);
  assert.match(txt, /reprovação definitiva/);

  const semFicha = criarCanal('TK2', 'ticket-y');
  await F.aoTicketAberto({ canal: semFicha, categoria: 'recrutamento', usuario: { id: 'NINGUEM' } });
  assert.match(textoDe(semFicha), /Nenhuma ficha/);

  const parceria = criarCanal('TK3', 'ticket-z');
  await F.aoTicketAberto({ canal: parceria, categoria: 'parceria', usuario: { id: 'DT' } });
  assert.equal(parceria.enviadas.length, 0, 'só recrutamento ganha contexto');
});

test('triagem da ficha: avisos + quem está com o jogo aberto, sem pingar ninguém', async () => {
  const { avisarNaFicha } = require('../utils/inteligencia/barreira');
  const canal = criarCanal('VS2', 'validar');
  const msg = criarMensagem(canal, {});
  let payload = null;
  msg.reply = async p => { payload = p; return canal.send(p); };

  assert.equal(await avisarNaFicha({ mensagem: msg, nome: 'Pessoa Inédita Total', idFivem: '4242', client: guild.client }), true);
  assert.match(textoDe(canal), /Nenhum recrutador com o jogo aberto/);
  assert.match(textoDe(canal), /TRIAGEM DA FICHA/);

  await log({ acao: 'jogador_entrou', ator: '55', atorNome: 'Rec', quando: antes(30 * 60 * 1000) });
  assert.equal(await avisarNaFicha({ mensagem: msg, nome: 'Pessoa Inédita Total', idFivem: '4242', client: guild.client }), true);
  const ultima = canal.enviadas.at(-1);
  assert.match(JSON.stringify(ultima.embeds), /<@REC1>/);
  assert.deepEqual(payload.allowedMentions, { parse: [] }, 'lista quem está online sem notificar');
});

test('campo de inteligência: aparece no resumo do associado e no contexto da ADV', async () => {
  const en = require('../utils/enriquecedores');
  F.assinar();
  const campos = await en.coletar('historico.resumo', { idFivem: '100' });
  assert.equal(campos.length, 1);
  assert.match(campos[0].value, /Risco/);
  assert.match(campos[0].value, /Baú\/Banco/);
  const adv = await en.coletar('adv.contexto', { membro: guild.members.cache.get('S1') });
  assert.equal(adv.length, 1);
  assert.deepEqual(await en.coletar('historico.resumo', { idFivem: '999999' }), [], 'sem resumo, sem campo');
});

test('saiu no jogo e continua sócio no Discord (e quem voltou não conta)', async () => {
  await log({ acao: 'saiu_torcida', ator: '100', atorNome: 'Zeca', quando: antes(DIA) });
  await log({ acao: 'saiu_torcida', ator: '55', atorNome: 'Rec', quando: antes(2 * DIA) });
  await log({ acao: 'jogador_recrutou', ator: '1', alvo: '55', alvoNome: 'Rec', quando: antes(DIA) }); // voltou
  const saidas = await repo.saidasRecentesSemRetorno(3);
  assert.deepEqual(saidas.map(s => s.id), ['100']);

  const canal = criarCanal('SS', 'x');
  const porIdFivem = new Map([['100', { discordId: 'S1', membro: guild.members.cache.get('S1') }]]);
  assert.equal(await V.alertarSaiuMasSegueSocio(canal, saidas, porIdFivem), 1);
  assert.match(textoDe(canal), /SAIU NO JOGO, CONTINUA SÓCIO NO DISCORD/);
  assert.equal(await V.alertarSaiuMasSegueSocio(canal, saidas, porIdFivem), 0, 'mesma saída não repete');
  assert.equal(await V.alertarSaiuMasSegueSocio(canal, saidas, new Map()), 0, 'sem sócio com esse ID: nada divergente');
});

test('cargo de recrutador: promoção sem cargo e rebaixamento com cargo no Discord', async () => {
  const canal = criarCanal('CD', 'x');
  const rec = guild.members.cache.get('REC1');
  const socio = guild.members.cache.get('S1');
  const porIdFivem = new Map([['55', { discordId: 'REC1', membro: rec }], ['100', { discordId: 'S1', membro: socio }]]);
  const t = d => antes(d * DIA);
  const movimentos = [
    { acao: 'promoveu_cargo', alvo_id_fivem: '100', ator_nome: 'Chefe', ocorrido_em: t(3) }, // S1 promovido, sem cargo
    { acao: 'rebaixou_cargo', alvo_id_fivem: '55', ator_nome: 'Chefe', ocorrido_em: t(2) }, // REC1 rebaixado, com cargo
    { acao: 'promoveu_cargo', alvo_id_fivem: '55', ator_nome: 'Chefe', ocorrido_em: t(90) }, // antigo: ignora
  ];
  assert.equal(await V.alertarCargoDivergente(canal, movimentos, porIdFivem), 2);
  const txt = textoDe(canal);
  assert.match(txt, /promovido no jogo/);
  assert.match(txt, /rebaixado no jogo/);
  socio.roles.cache.set(config.cargos.recrutador, { id: config.cargos.recrutador });
  const coerente = criarCanal('CD2', 'x');
  assert.equal(await V.alertarCargoDivergente(coerente, [movimentos[0]], porIdFivem), 0, 'agora o cargo bate com o jogo');
  socio.roles.cache.delete(config.cargos.recrutador);
});

test('responsável em risco e renovação de carteirinha de quem está em risco', async () => {
  const canal = criarCanal('RR', 'x');
  const rec = guild.members.cache.get('REC1');
  const resumo = (id, membro, adv, restr, esfriando = false, score = 40) => ({
    socio: { discordId: id, membro }, risco: { score, nivel: 'MÉDIO' },
    dados: { advAtivas: adv, restricoesAtivas: restr, esfriando, fatores: ['x'] },
  });
  const cargos = new Map([[config.cargos.recrutador, 'recrutador']]);
  assert.equal(await V.alertarResponsavelEmRisco(canal, [resumo('REC1', rec, 2, [])], cargos), 1);
  assert.match(textoDe(canal), /recrutador/);
  assert.equal(await V.alertarResponsavelEmRisco(canal, [resumo('REC1', rec, 2, [])], cargos), 0, 'mesmo estado: 14 dias sem repetir');
  assert.equal(await V.alertarResponsavelEmRisco(canal, [resumo('REC1', rec, 1, [])], cargos), 0, '1 ADV e sem restrição não é grave');

  const canal2 = criarCanal('RN', 'x');
  const carteirinhas = [{ discord_id: 'S1', validade: new Date(Date.now() + 3 * DIA) }, { discord_id: 'S2', validade: new Date(Date.now() + 3 * DIA) }];
  const porDiscord = new Map([['S1', resumo('S1', null, 0, [], true)], ['S2', resumo('S2', null, 0, [], false, 5)]]);
  assert.equal(await V.alertarRenovacaoEmRisco(canal2, carteirinhas, porDiscord), 1, 'só quem está em risco ou esfriando');
  assert.match(textoDe(canal2), /RENOVAÇÃO DE CARTEIRINHA/);
});

test('carteirinhas vencendo: consulta o módulo dono e respeita a janela', async () => {
  await banco.q("INSERT INTO socios (discord_id, numero_socio, nome, validade) VALUES ('C1', 1, 'A', current_date + 2), ('C2', 2, 'B', current_date + 40), ('C3', 3, 'C', current_date - 10)");
  const vencendo = await require('../utils/carteirinha/inteligencia').vencendo(7);
  assert.deepEqual(vencendo.map(v => v.discord_id), ['C1']);
});
