// Painel de recrutadores: cruzamentos além da contagem (último recrutamento, tendência,
// meta, qualidade dos recrutados, fantasmas), tabelas de uma linha por recrutador,
// ficha com horários, meta editável e avisos preventivos. Banco em memória, sem Discord real.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_SSL = 'off';
const { instalarBanco } = require('../tools/banco-em-memoria');
const { criarMembro, criarServidor, criarInteracao } = require('../tools/discord-falso');

const HORA = 3600 * 1000;
const DIA = 24 * HORA;
let banco;
let config;
let logs;
let I;
let P;
let E;
let seq = 0;

const atras = ms => new Date(Date.now() - ms);
const registro = extra => ({
  messageId: `IR${++seq}`, embedIndice: 0, canalId: config.logsJogo.canais[1], categoria: 'recrutamento',
  atorNome: null, atorIdFivem: null, alvoNome: null, alvoIdFivem: null, valor: null, titulo: null, descricao: 'x', bruto: {}, ...extra,
});
const recrutou = (recrutador, recrutado, quando) => logs.inserirRegistro(registro({
  acao: 'jogador_recrutou', atorNome: 'Rec', atorIdFivem: recrutador, alvoNome: 'Novo', alvoIdFivem: recrutado, ocorridoEm: quando,
}));
const linhaBase = extra => ({
  discordId: 'REC1', nome: 'R GDF | Rec - 55', idFivem: '55', recrutamentos: 4, ms: 5 * HORA, saiuCedo: 0, online: false, ultimaConexao: null, ...extra,
});

test.before(async () => {
  banco = await instalarBanco();
  config = require('../config/index.js');
  logs = require('../utils/logsJogo/repositorio');
  I = require('../utils/logsJogo/inteligenciaRecrutadores');
  P = require('../utils/logsJogo/painelRecrutadoresInteracoes');
  E = require('../utils/logsJogo/estatisticas');
});
test.after(async () => { await banco.pglite.close(); });

test('formatação: tempo desde, tendência, meta, fração e horários', () => {
  const agora = new Date();
  const atras = ms => new Date(agora.getTime() - ms); // relativo a `agora`: com Date.now() os ms de folga faziam '19min' sob carga
  assert.equal(I.tempoDesde(null, agora), '—');
  assert.equal(I.tempoDesde(atras(20 * 60000), agora), '20min');
  assert.equal(I.tempoDesde(atras(3 * HORA), agora), '3h');
  assert.equal(I.tempoDesde(atras(4 * DIA + HORA), agora), '4d');
  assert.equal(I.tempoDesde(atras(400 * DIA), agora), '99d+');
  assert.equal(I.celulaOnline({ idFivem: '1', online: true }, agora), 'agora');
  assert.equal(I.celulaOnline({ idFivem: '1', online: false, ultimaConexao: { em: new Date(agora.getTime() - 2 * DIA) } }, agora), '2d'); // relativo a `agora`: com atras() os ms de folga faziam '1d' sob carga
  assert.equal(I.celulaOnline({ idFivem: null }, agora), '—');
  assert.equal(I.celulaTendencia(7, 4), '▲3');
  assert.equal(I.celulaTendencia(2, 6), '▼4');
  assert.equal(I.celulaTendencia(3, 3), '=');
  assert.equal(I.celulaTendencia(3, null), '—');
  assert.equal(I.celulaMeta(3, 5), '60%');
  assert.equal(I.celulaMeta(3, 0), '—');
  assert.equal(I.celulaFracao(2, 10), '2/10');
  assert.equal(I.celulaFracao(0, 0), '—');
  const recruta = [{ hora: 20, total: 9 }, { hora: 21, total: 4 }, { hora: 3, total: 1 }, { hora: 19, total: 6 }];
  assert.deepEqual(I.horasPico(recruta), ['19h (6)', '20h (9)', '21h (4)']);
  const entra = [{ hora: 20, total: 12 }, { hora: 15, total: 8 }, { hora: 10, total: 2 }];
  assert.deepEqual(I.horasSemRecrutar(entra, recruta), ['15h (8 entradas)'], 'só horas sem recrutamento e com entradas suficientes');
});

test('cruzamento: último recrutamento, tendência, meta, problemas e fantasmas', async () => {
  const l = linhaBase();
  await recrutou('55', '901', atras(10 * DIA));   // deu problema (advertido 5 dias depois) e sumiu
  await recrutou('55', '902', atras(9 * DIA));    // sumiu
  await recrutou('55', '903', atras(8 * DIA));    // voltou (tem log como ator depois)
  await recrutou('55', '904', atras(1 * DIA));    // recente: ainda não conta como fantasma
  await recrutou('55', '905', atras(45 * DIA));   // período anterior (tendência)
  await logs.inserirRegistro(registro({ acao: 'advertido', alvoIdFivem: '901', alvoNome: 'Novo', ocorridoEm: atras(5 * DIA) }));
  await logs.inserirRegistro(registro({ acao: 'advertido', alvoIdFivem: '903', alvoNome: 'Novo', ocorridoEm: atras(45 * DIA) })); // antes do recrutamento: não conta
  await logs.inserirRegistro(registro({ acao: 'jogador_entrou', atorIdFivem: '903', atorNome: 'Novo', ocorridoEm: atras(6 * DIA) }));

  const periodo = E.resolverPeriodo('30d');
  await I.enriquecerRecrutadores([l], periodo);
  assert.equal(l.problemas, 1);
  assert.equal(l.maduros, 3);
  assert.equal(l.fantasmas, 2);
  assert.equal(l.rec7, 1);
  assert.equal(l.anterior, 1);
  assert.equal(Math.round((Date.now() - new Date(l.ultimoRecrutou)) / DIA), 1);
  assert.equal(l.meta, I.META_PADRAO);
  assert.equal(l.atencao.length, 0, 'abaixo da amostra mínima não vira atenção');

  const semId = linhaBase({ idFivem: null, discordId: 'REC9' });
  await I.enriquecerRecrutadores([semId], periodo);
  assert.equal(semId.ultimoRecrutou, null);
});

test('atenção: 3+ recrutados com problema ou fantasmas (metade ou mais) aparecem na linha', async () => {
  await banco.q('DELETE FROM logs_jogo');
  for (const n of ['1', '2', '3']) {
    await recrutou('66', `80${n}`, atras(12 * DIA));
    await logs.inserirRegistro(registro({ acao: 'blacklist_adicionou', alvoIdFivem: `80${n}`, ocorridoEm: atras(10 * DIA) }));
  }
  const l = linhaBase({ discordId: 'REC2', idFivem: '66', recrutamentos: 3 });
  await I.enriquecerRecrutadores([l], E.resolverPeriodo('30d'));
  assert.equal(l.problemas, 3);
  assert.equal(l.fantasmas, 3);
  assert.equal(l.atencao.length, 2);
  assert.match(l.atencao[0], /3 de 3 recrutados tiveram advertência, blacklist ou impedimento em até 30 dias/);
  assert.match(l.atencao[1], /3 de 3 recrutados nunca mais apareceram no jogo/);
});

test('tabelas: uma linha por recrutador, título completo, cabe em 56 colunas e no limite do Discord', () => {
  const agora = new Date();
  const linhas = Array.from({ length: 45 }, (_, i) => linhaBase({
    discordId: `R${i}`, nome: `R GDF | Recrutador De Nome Muito Comprido ${i} - ${1000 + i}`, idFivem: String(1000 + i),
    recrutamentos: 50 - i, online: i % 3 === 0, ultimoRecrutou: atras(i * HORA * 5), anterior: 20, rec7: i, meta: 5,
    problemas: i % 4, fantasmas: i % 3, maduros: 10, atencao: i % 5 === 0 ? [`Aviso do recrutador ${i}.`] : [],
    advNivel: i % 3, erros7: i % 4, incompletas7: i % 2, ultimaConexao: { em: atras(i * HORA) },
  }));
  const embeds = P.embedsRecrutadores({ titulo: 'TÍTULO', resumo: ['**RECRUTADORES:** 45'], linhas, agora });
  assert.equal(embeds.length, 3);
  const total = embeds.reduce((s, e) => s + (e.title?.length ?? 0) + e.description.length, 0);
  assert.ok(total <= 5600, `soma dos embeds = ${total}`);
  for (const e of embeds) assert.ok(e.description.length <= 4096);
  const texto = embeds.map(e => e.description).join('\n');
  for (const titulo of ['RECRUTADOR', 'RECRUT.', 'RETENÇÃO', 'TEMPO', 'RECRUTOU', 'ONLINE', 'TENDÊNCIA', 'META', 'ADV', 'PROBLEMAS', 'FANTASMAS', 'MANTO', 'FICHAS']) {
    assert.ok(texto.includes(titulo), `falta o título ${titulo}`);
  }
  const grade = texto.split('\n').filter(x => /^[#● ]?\s*\d?\s*[●\sA-Za-z0-9]/.test(x) && !x.startsWith('-#') && !x.startsWith('**') && !x.startsWith('```') && !x.startsWith('⚠️') && !x.startsWith('*'));
  const largas = grade.filter(x => x.length > 58);
  assert.deepEqual(largas.slice(0, 3), [], 'linha de tabela passou de 58 colunas');
  assert.match(texto, /ocultos/, 'cortou o excesso em vez de estourar o limite');
  assert.match(embeds[0].description, /ATENÇÃO \(\d+\)/);
  assert.ok(embeds[2].footer?.text, 'rodapé no último embed');
});

test('sem o módulo de advertência não há colunas ADV, MANTO e FICHAS', () => {
  const l = linhaBase({ ultimoRecrutou: atras(2 * DIA), anterior: 3, rec7: 2, meta: 5, problemas: 0, fantasmas: 0, maduros: 0, atencao: [] });
  const texto = P.embedsRecrutadores({ titulo: 'T', resumo: [], linhas: [l] }).map(e => e.description).join('\n');
  assert.ok(!/ADV\b/.test(texto.replace('ADVERT', '')), 'ADV só com o módulo');
  assert.ok(!/MANTO\s+FICHAS/.test(texto));
  assert.match(texto, /RECRUTOU\s+ONLINE\s+TENDÊNCIA\s+META/);
});

test('meta semanal: só liderança altera; valor inválido é recusado; grava e muda a coluna META', async () => {
  const lider = criarMembro('L1', { cargos: [config.lideranca[0]] });
  const comum = criarMembro('C1', { cargos: [] });
  const guild = criarServidor({ membros: [lider, comum] });
  const { despacharInteracao: despachar } = require('../utils/modulos');

  const negado = criarInteracao({ customId: 'recrutadores:meta', membro: comum, guild });
  await despachar(negado);
  assert.match(negado.texto(), /LIDERAN/i);

  const abre = criarInteracao({ customId: 'recrutadores:meta', membro: lider, guild });
  await despachar(abre);
  assert.equal(abre.acao('showModal').length, 1);

  const ruim = criarInteracao({ customId: 'recrutadores:metamodal', membro: lider, guild, tipo: 'modal', campos: { valor: 'abc' } });
  await despachar(ruim);
  assert.match(ruim.texto(), /NÚMERO INTEIRO/);
  assert.equal(await I.lerMeta(), I.META_PADRAO);

  const ok = criarInteracao({ customId: 'recrutadores:metamodal', membro: lider, guild, tipo: 'modal', campos: { valor: '10' } });
  await despachar(ok);
  assert.match(ok.texto(), /META SEMANAL: \*\*10\*\*/);
  assert.equal(await I.lerMeta(), 10);
  const l = linhaBase({ idFivem: '55' });
  await I.enriquecerRecrutadores([l], E.resolverPeriodo('30d'));
  assert.equal(l.meta, 10);

  const zero = criarInteracao({ customId: 'recrutadores:metamodal', membro: lider, guild, tipo: 'modal', campos: { valor: '0' } });
  await despachar(zero);
  assert.match(zero.texto(), /DESLIGADA/);
  assert.equal(I.celulaMeta(3, await I.lerMeta()), '—');
});

test('ficha do recrutador traz último recrutamento, qualidade e horários', async () => {
  await banco.q('DELETE FROM logs_jogo');
  await I.gravarMeta(I.META_PADRAO);
  await recrutou('77', '701', atras(2 * DIA));
  await logs.inserirRegistro(registro({ acao: 'jogador_entrou', atorIdFivem: '77', atorNome: 'Rec', ocorridoEm: atras(1 * DIA) }));
  await logs.inserirRegistro(registro({ acao: 'jogador_entrou', atorIdFivem: '77', atorNome: 'Rec', ocorridoEm: atras(2 * DIA) }));
  await logs.inserirRegistro(registro({ acao: 'jogador_entrou', atorIdFivem: '77', atorNome: 'Rec', ocorridoEm: atras(3 * DIA) }));

  const horarios = await I.horariosDoRecrutador('77');
  assert.equal(horarios.recruta.reduce((s, h) => s + h.total, 0), 1);
  assert.equal(horarios.entra.reduce((s, h) => s + h.total, 0), 3);

  const l = linhaBase({ idFivem: '77', recrutamentos: 1 });
  await I.enriquecerRecrutadores([l], E.resolverPeriodo('30d'));
  l.disciplinaTexto = 'sem advertência ativa';
  const membro = criarMembro('REC1', { cargos: [config.cargos.recrutador], apelido: 'R GDF | Rec - 77' });
  const ficha = { idFivem: '77', sessaoAtual: null, porPeriodo: [{ chave: '7d', rotulo: 'ÚLTIMOS 7 DIAS', ms: HORA }] };
  const { embedFichaRecrutador } = P;
  assert.equal(typeof embedFichaRecrutador, 'function');
  const embed = embedFichaRecrutador(membro, ficha, new Map(), l, horarios);
  assert.match(embed.description, /ÚLTIMO RECRUTAMENTO:\*\* <t:\d+:R>/);
  assert.match(embed.description, /META SEMANAL:\*\* 1\/\d+/);
  assert.match(embed.description, /QUALIDADE \(30D\)/);
  assert.match(embed.description, /DISCIPLINA:\*\* sem advertência ativa/);
  assert.match(embed.description, /RECRUTA MAIS ÀS:\*\* \d\dh \(1\)/);
  assert.match(embed.description, /ENTRA NO JOGO MAIS ÀS:/);
  assert.ok(embed.description.length < 4096);
});
