// Advertência automática de recrutador: cruza inteligência de recrutadores, manto e
// fichas com a escada (1ª aviso, 2ª prazo para voltar a recrutar, 3ª perde o cargo).
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_SSL = 'off';
const { instalarBanco } = require('../tools/banco-em-memoria');
const { criarCanal, criarMembro, criarServidor } = require('../tools/discord-falso');
const R = require('../utils/advertenciaRecrutadorAuto/regras');

const HORA = 3600 * 1000;
const DIA = 24 * HORA;
let banco;
let config;
let varredura;
let repo;
let guild;
let canal;
let rec;

const texto = () => JSON.stringify(canal.enviadas.map(m => m.embeds));
const base = extra => ({
  discordId: 'REC1', idFivem: '55', rec5: 4, ms5: 5 * HORA, online: false, rec7: 4, ms7: 5 * HORA,
  rec14: 4, saiuCedo14: 0, erros7: 0, incompletas7: 0, cargoDesde: null, ultimaPorRegra: {}, ...extra,
});
const rodar = (dados, agora = new Date()) => varredura.executarVarredura(guild.client, { agora, coletar: async () => dados });

test.before(async () => {
  banco = await instalarBanco();
  config = require('../config/index.js');
  varredura = require('../utils/advertenciaRecrutadorAuto/varredura');
  repo = require('../utils/advertenciaRecrutadorAuto/repositorio');
  canal = criarCanal(config.canais.historicoAdvRec, 'historico-adv-rec');
  rec = criarMembro('REC1', { cargos: [config.cargos.recrutador], apelido: 'R GDF | Rec - 55' });
  guild = criarServidor({ canais: [canal], membros: [rec] });
});
test.after(async () => { await banco.pglite.close(); });

test('regras: cada limite dispara só quando cruzado', () => {
  const agora = new Date();
  assert.deepEqual(R.decidir(base(), agora), { removerCargo: null, infracoes: [] });
  assert.equal(R.decidir(base({ rec5: 0 }), agora).infracoes[0].regra, 'sem_recrutar_jogando');
  assert.equal(R.decidir(base({ rec5: 0, ms5: 5 * 60 * 1000 }), agora).infracoes.length, 0, 'só logou: não jogou de verdade');
  assert.equal(R.decidir(base({ rec5: 0, cargoDesde: new Date(agora - 2 * DIA) }), agora).infracoes.length, 0, 'cargo recente tem carência');
  assert.match(R.decidir(base({ rec7: 0, ms7: 0, rec5: 0, ms5: 0 }), agora).removerCargo, /Inatividade/);
  assert.equal(R.decidir(base({ rec7: 0, ms7: 0, rec5: 0, ms5: 0, online: true }), agora).removerCargo, null, 'online agora: não está inativo');
  assert.equal(R.decidir(base({ rec14: 4, saiuCedo14: 3 }), agora).infracoes[0].regra, 'retencao_baixa');
  assert.equal(R.decidir(base({ rec14: 2, saiuCedo14: 2 }), agora).infracoes.length, 0, 'amostra mínima de 3');
  assert.equal(R.decidir(base({ erros7: 2 }), agora).infracoes.length, 0);
  assert.equal(R.decidir(base({ erros7: 3 }), agora).infracoes[0].regra, 'manto_errado');
  assert.equal(R.decidir(base({ incompletas7: 3 }), agora).infracoes[0].regra, 'ficha_incompleta');
  const recente = { manto_errado: new Date(agora - DIA) };
  assert.equal(R.decidir(base({ erros7: 5, ultimaPorRegra: recente }), agora).infracoes.length, 0, 'intervalo mínimo entre advertências da mesma regra');
  assert.deepEqual(R.planoDaAdvertencia(1, 'sem_recrutar_jogando'), { nivel: 2, removeCargo: false, prazoMs: 2 * DIA });
  assert.equal(R.planoDaAdvertencia(1, 'manto_errado').prazoMs, null);
  assert.equal(R.planoDaAdvertencia(2, 'manto_errado').removeCargo, true);
});

test('jogando sem recrutar: 1ª advertência com justificativa, e não repete no mesmo intervalo', async () => {
  const ag = new Date();
  const r = await rodar([base({ rec5: 0 })], ag);
  assert.deepEqual(r.advertidos, [['REC1', 'sem_recrutar_jogando']]);
  const [a] = await banco.q('SELECT * FROM advertencias_recrutador');
  assert.equal(a.nivel, 1);
  assert.match(texto(), /1ª \(AUTOMÁTICA\)[\s\S]*JOGANDO SEM RECRUTAR[\s\S]*Jogou 5h00/);
  const de = await banco.q('SELECT ultima FROM (SELECT max(criada_em) AS ultima FROM advertencias_recrutador) x');
  const r2 = await rodar([base({ rec5: 0, ultimaPorRegra: { sem_recrutar_jogando: de[0].ultima } })], ag);
  assert.equal(r2.advertidos.length, 0);
});

test('perdão: recrutando 3 depois da advertência por inatividade, ela sai', async () => {
  const logs = require('../utils/logsJogo/repositorio');
  for (let i = 0; i < 3; i++) {
    await logs.inserirRegistro({
      messageId: `REC${i}`, embedIndice: 0, canalId: config.logsJogo.canais[1], categoria: 'recrutamento', acao: 'jogador_recrutou',
      atorNome: 'Rec', atorIdFivem: '55', alvoNome: 'X', alvoIdFivem: `9${i}`, valor: null, titulo: null, descricao: 'x',
      ocorridoEm: new Date(Date.now() + 1000), bruto: {},
    });
  }
  await rodar([base()], new Date(Date.now() + 5000));
  const [a] = await banco.q('SELECT status FROM advertencias_recrutador ORDER BY id LIMIT 1');
  assert.equal(a.status, 'PERDOADA');
  assert.match(texto(), /1ª REMOVIDA/);
});

test('escada: 2ª de inatividade tem prazo e tarefa; 3ª remove o cargo de recrutador', async () => {
  await banco.q('DELETE FROM advertencias_recrutador');
  await rodar([base({ rec5: 0 })]);                                   // 1ª (manto/ficha não usam prazo)
  await banco.q("UPDATE advertencias_recrutador SET criada_em = now() - interval '6 days'");
  await rodar([base({ rec5: 0 })]);                                   // 2ª por inatividade
  const [seg] = await banco.q('SELECT * FROM advertencias_recrutador WHERE nivel = 2');
  assert.ok(seg.prazo_em);
  const [t] = await banco.q("SELECT payload FROM tarefas_agendadas WHERE tipo = 'adv_rec_auto_vencimento'");
  assert.equal(t.payload.advId, seg.id);

  await banco.q("UPDATE advertencias_recrutador SET criada_em = now() - interval '6 days'");
  await rodar([base({ rec5: 0 })]);                                   // 3ª
  const [terc] = await banco.q('SELECT * FROM advertencias_recrutador WHERE nivel = 3');
  assert.equal(terc.status, 'CARGO_REMOVIDO');
  assert.ok(!rec.roles.cache.has(config.cargos.recrutador));
  assert.match(texto(), /CARGO DE RECRUTADOR REMOVIDO/);
});

test('inatividade total (7 dias sem jogar nem recrutar) tira o cargo sem advertência', async () => {
  await banco.q('DELETE FROM advertencias_recrutador');
  await rec.roles.add(config.cargos.recrutador);
  const r = await rodar([base({ rec5: 0, ms5: 0, rec7: 0, ms7: 0 })]);
  assert.deepEqual(r.cargosRemovidos, ['REC1']);
  assert.ok(!rec.roles.cache.has(config.cargos.recrutador));
  const [a] = await banco.q('SELECT nivel, regra, status FROM advertencias_recrutador');
  assert.deepEqual(a, { nivel: 0, regra: 'inatividade', status: 'CARGO_REMOVIDO' });
});

test('manto errado e ficha incompleta: consultas contam por quem decidiu a ficha', async () => {
  await banco.q(`INSERT INTO fichas_recrutamento (message_id, discord_id, nome, idade, id_fivem, telefone, status, decidido_por_id, decidido_em, criado_em)
    VALUES ('F1','C1','Ana',20,'1','',  'APROVADO','REC1', now(), now() - interval '2 days'),
           ('F2','C2','Bia',22,'2','99','APROVADO','REC1', now(), now() - interval '2 days'),
           ('F3','C3','',25,'3','98',    'APROVADO','REC1', now(), now() - interval '2 days')`);
  await banco.q(`INSERT INTO mantos_avaliados (message_id, candidato_id, enviado_em, resultado, avaliado_em)
    VALUES ('M1','C1', now() - interval '1 day','ERRADO', now()), ('M2','C2', now() - interval '1 day','ERRADO', now()),
           ('M3','C3', now() - interval '1 day','CORRETO', now())`);
  const desde = new Date(Date.now() - 7 * DIA);
  assert.equal((await repo.errosDeMantoPorRecrutador(desde)).get('REC1'), 2);
  assert.equal((await repo.fichasIncompletasPorRecrutador(desde)).get('REC1'), 2, 'telefone vazio e nome vazio');
});

test('quadros: regras seguem os limites do bot e a tabela mostra advertidos, limpos e resoluções', async () => {
  const paineis = require('../utils/advertenciaRecrutadorAuto/paineis');
  const regras = JSON.stringify(paineis.blocosRegras());
  assert.match(regras, /COMO FUNCIONA O RECRUTAMENTO/);
  assert.match(regras, /5 dias/);
  assert.match(regras, /3 recrutamentos/);
  assert.match(regras, /Escada/);

  await banco.q('DELETE FROM advertencias_recrutador');
  const limpo = criarMembro('REC2', { cargos: [config.cargos.recrutador], apelido: 'R GDF | Dois - 66' });
  const advertido = criarMembro('REC3', { cargos: [config.cargos.recrutador], apelido: 'R GDF | Tres - 77' });
  const g = criarServidor({ membros: [limpo, advertido] });
  await repo.inserir({ discordId: 'REC3', nivel: 1, regra: 'manto_errado', motivo: '3 mantos aprovados errado' });
  const velha = await repo.inserir({ discordId: 'REC2', nivel: 1, regra: 'sem_recrutar_jogando', motivo: 'x' });
  await repo.encerrar(velha.id, 'PERDOADA', 'voltou');

  const blocos = await paineis.montarAdvertidos(g.client);
  const t = JSON.stringify(blocos);
  assert.match(t, /Advertidos:\*\* 1 · \*\*Sem advertência:\*\* 1/);
  assert.match(t, /<@REC3>[\s\S]*1ª advertência ativa[\s\S]*MANTO APROVADO ERRADO[\s\S]*3 mantos aprovados errado/);
  assert.match(t, /SEM ADVERTÊNCIA[\s\S]*<@REC2>/);
  assert.match(t, /PERDOADA · JOGANDO SEM RECRUTAR/);
});

test('riscos: avisa a até 2 dias do limite, nunca antes nem depois', () => {
  const agora = new Date();
  const ha = d => new Date(agora - d * DIA);
  assert.equal(R.riscos(base({ ultimoRecrutou: ha(1) }), agora).length, 0, 'recrutou ontem: longe do limite');
  const perto = R.riscos(base({ ultimoRecrutou: ha(4) }), agora);
  assert.equal(perto[0].regra, 'sem_recrutar_jogando');
  assert.equal(perto[0].restamDias, 1);
  assert.match(perto[0].texto, /Último recrutamento há 4 dias/);
  assert.equal(R.riscos(base({ ultimoRecrutou: ha(4), ms5: 5 * 60 * 1000 }), agora).length, 0, 'só logou: não conta como jogar');
  assert.equal(R.riscos(base({ ultimoRecrutou: ha(6), rec5: 0 }), agora).filter(x => x.regra === 'sem_recrutar_jogando').length, 0, 'já passou: é advertência, não aviso');
  assert.equal(R.riscos(base(), agora).length, 0, 'sem data do último recrutamento não avisa por tempo');

  const inativo = R.riscos(base({ rec7: 0, ms7: 0, rec5: 0, ms5: 0, ultimoRecrutou: ha(6), ultimaConexaoEm: ha(5.5) }), agora);
  assert.equal(inativo[0].regra, 'inatividade');
  assert.match(inativo[0].texto, /perde o cargo/);
  assert.equal(R.riscos(base({ rec7: 0, ms7: 0, rec5: 0, ms5: 0, online: true, ultimoRecrutou: ha(6) }), agora).length, 0, 'online: não está inativo');

  assert.equal(R.riscos(base({ rec14: 10, saiuCedo14: 5 }), agora)[0].regra, 'retencao_baixa');
  assert.equal(R.riscos(base({ rec14: 10, saiuCedo14: 2 }), agora).length, 0);
  assert.equal(R.riscos(base({ rec14: 10, saiuCedo14: 6 }), agora).length, 0, 'abaixo do limite é infração, não aviso');
  assert.equal(R.riscos(base({ erros7: 2 }), agora)[0].regra, 'manto_errado');
  assert.equal(R.riscos(base({ incompletas7: 2 }), agora)[0].regra, 'ficha_incompleta');
  assert.equal(R.riscos(base({ erros7: 2, ultimaPorRegra: { manto_errado: ha(1) } }), agora).length, 0, 'já advertido recentemente');
});

test('aviso preventivo: canal e DM, uma vez por intervalo, sem virar advertência; painel enxerga o risco', async () => {
  await banco.q('DELETE FROM advertencias_recrutador');
  await rec.roles.add(config.cargos.recrutador);
  canal.enviadas.length = 0;
  rec.dms.length = 0;
  const ag = new Date();
  const dados = base({ ultimoRecrutou: new Date(ag - 4 * DIA) });

  const r = await rodar([dados], ag);
  assert.deepEqual(r.avisados, [['REC1', 'sem_recrutar_jogando']]);
  assert.equal(r.advertidos.length, 0);
  assert.match(texto(), /RISCO DE ADVERTÊNCIA[\s\S]*JOGANDO SEM RECRUTAR[\s\S]*Último recrutamento há 4 dias/);
  assert.equal(rec.dms.length, 1);
  assert.match(JSON.stringify(rec.dms[0]), /ATENÇÃO, RECRUTADOR/);
  assert.equal((await banco.q('SELECT count(*)::int AS n FROM advertencias_recrutador'))[0].n, 0, 'aviso não é advertência');

  const r2 = await rodar([dados], new Date(ag.getTime() + HORA));
  assert.deepEqual(r2.avisados, [], 'não repete dentro do intervalo');
  assert.equal(rec.dms.length, 1);
  const depois = new Date(ag.getTime() + 3 * DIA);
  const r3 = await rodar([base({ ultimoRecrutou: new Date(depois - 4 * DIA) })], depois);
  assert.deepEqual(r3.avisados.map(([, regra]) => regra), ['sem_recrutar_jogando'], 'passado o intervalo, avisa de novo');

  // O painel de recrutadores lê a situação disciplinar e o risco da última varredura
  await repo.inserir({ discordId: 'REC1', nivel: 1, regra: 'manto_errado', motivo: 'x' });
  const inteligencia = require('../utils/advertenciaRecrutadorAuto/inteligencia');
  const linhas = [{ discordId: 'REC1', atencao: [] }, { discordId: 'REC2', atencao: [] }];
  await inteligencia.enriquecer(linhas, null, new Date());
  assert.equal(linhas[0].advNivel, 1);
  assert.match(linhas[0].disciplinaTexto, /1ª advertência ativa \(MANTO APROVADO ERRADO\)/);
  assert.equal(linhas[1].advNivel, 0);
  assert.equal(linhas[0].atencao.length, 1);
  assert.match(linhas[0].atencao[0], /Último recrutamento há/);
});
