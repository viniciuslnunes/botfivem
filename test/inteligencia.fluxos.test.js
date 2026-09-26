// Inteligência cruzada ponta a ponta: consultas em Postgres real em memória (PGlite), espelho do
// "não recrutar", debounce persistente, resumo do associado, alertas da varredura, barreira de
// entrada, confiança de conduta e relatórios. Nada toca o banco real nem o Discord.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_SSL = 'off';
const { instalarBanco } = require('../tools/banco-em-memoria');
const { criarCanal, criarMembro, criarServidor } = require('../tools/discord-falso');

const HORA = 3600 * 1000;
const DIA = 24 * HORA;
let banco;
let config;
let repo;
let R;
let V;
let guild;
let canalInt;
let contadorLog = 0;

const textoDe = canal => JSON.stringify(canal.enviadas.map(m => ({ c: m.content, e: m.embeds })));
const antes = ms => new Date(Date.now() - ms);

async function log({ acao, ator = null, alvo = null, atorNome = null, alvoNome = null, valor = null, quando = antes(HORA), titulo = null, descricao = null }) {
  contadorLog++;
  await banco.q(
    `INSERT INTO logs_jogo (message_id, embed_indice, canal_id, categoria, acao, ator_nome, ator_id_fivem, alvo_nome, alvo_id_fivem, valor, titulo, descricao, ocorrido_em, bruto)
     VALUES ($1, 0, 'c', 'x', $2, $3, $4, $5, $6, $7, $8, $9, $10, '{}'::jsonb)`,
    [String(1000 + contadorLog), acao, atorNome, ator, alvoNome, alvo, valor, titulo, descricao, quando]
  );
}

test.before(async () => {
  banco = await instalarBanco();
  config = require('../config/index.js');
  repo = require('../utils/inteligencia/repositorio');
  R = require('../utils/inteligencia/regras');
  V = require('../utils/inteligencia/varredura');
  canalInt = criarCanal('INT', 'inteligencia');
  const socio = criarMembro('S1', { cargos: [config.cargos.socio], apelido: 'S | Zeca - 100' });
  socio.joinedTimestamp = Date.now() - 130 * DIA;
  guild = criarServidor({ id: config.guildId, canais: [canalInt], membros: [socio] });
});
test.after(async () => { await banco.pglite.close(); });

test('debounce persistente: primeira vez passa, repetição na janela não, chave nova passa', async () => {
  const { jaAlertadoRecentemente } = require('../utils/alertaPersistente');
  assert.equal(await jaAlertadoRecentemente('t', 'a', 6 * HORA), false);
  assert.equal(await jaAlertadoRecentemente('t', 'a', 6 * HORA), true);
  assert.equal(await jaAlertadoRecentemente('t', 'b', 6 * HORA), false);
  await banco.q("UPDATE alertas_enviados SET enviado_em = now() - interval '7 hours' WHERE chave = 'a'");
  assert.equal(await jaAlertadoRecentemente('t', 'a', 6 * HORA), false, 'janela vencida avisa de novo');
});

test('espelho do não recrutar: a mensagem mais nova decide e o desbloqueio vira inativo', async () => {
  const E = require('../utils/naoRecrutarEspelho');
  const embed = (idCampo, id, motivo, extra = []) => ({ fields: [{ name: idCampo, value: id }, { name: 'Motivo', value: motivo }, { name: 'Autor', value: '<@42>' }, ...extra] });
  const mensagens = [ // mais nova primeiro
    { id: 'm3', createdTimestamp: 3000, embeds: [embed('ID (DESBLOQUEADO)', '500', 'perdoado', [{ name: 'Removido por', value: '<@7>' }])] },
    { id: 'm2', createdTimestamp: 2000, embeds: [embed('ID', '600', 'trapaça')] },
    { id: 'm1', createdTimestamp: 1000, embeds: [embed('ID', '500', 'furto')] },
    { id: 'lixo', createdTimestamp: 900, embeds: [] },
  ];
  const estado = E.estadoDosBloqueios(mensagens);
  assert.equal(estado.length, 2);
  assert.equal(estado.find(e => e.idFivem === '500').ativo, false);
  assert.equal(estado.find(e => e.idFivem === '500').vezes, 2);
  assert.equal(estado.find(e => e.idFivem === '600').autorId, '42');
  await E.espelhar(mensagens);
  assert.deepEqual((await E.ativos()).map(a => a.id_fivem), ['600']);
});

test('resumo do associado: cruza ADV, restrição, reincidência, atividade e lista não recrutar', () => {
  const { montarResumo } = require('../utils/inteligencia/resumo');
  const agora = new Date();
  const r = montarResumo({
    advAtivas: 1, nivelMax: 2, pagamentoPendente: true,
    advs: [{ em: antes(10 * DIA) }],
    restricoes90: [{ acao: 'blacklist_adicionou', em: antes(5 * DIA) }],
    restricoesAtivas: [{ acao: 'blacklist_adicionou' }],
    h7Ms: 1 * HORA, h28Ms: 31 * HORA, ultimaAtividade: antes(20 * DIA + HORA), naoRecrutar: true,
  }, agora);
  assert.equal(r.dados.reincidente, true);
  assert.deepEqual(r.dados.restricoesAtivas, ['blacklist']);
  assert.equal(r.dados.esfriando, true);
  assert.equal(r.dados.semAtividadeDias, 20);
  assert.equal(r.risco.nivel, 'ALTO');
  assert.ok(r.dados.fatores.length >= 5);
});

test('consultas rodam em banco real e devolvem o que foi semeado', async () => {
  await log({ acao: 'blacklist_adicionou', ator: '1', alvo: '100', alvoNome: 'Zeca', quando: antes(5 * DIA) });
  await log({ acao: 'impedimento_adicionou', ator: '1', alvo: '100', alvoNome: 'Zeca', quando: antes(3 * DIA) });
  await log({ acao: 'bau_guardou', ator: '100', valor: 200, titulo: 'Guardou [Baú Sócio]', alvoNome: 'maconha' });
  await log({ acao: 'bau_removeu', ator: '100', valor: 20, titulo: 'Retirou [Baú Sócio]', alvoNome: 'maconha' });
  await log({ acao: 'banco_sacou', ator: '100', valor: 5000 });
  await log({ acao: 'coins_conquista', alvoNome: 'Porto', quando: antes(2 * DIA) });
  await log({ acao: 'jogador_entrou', ator: '100', atorNome: 'Zeca', quando: antes(2 * DIA) });

  assert.equal((await repo.restricoesAdicionadas(90)).length, 2);
  assert.deepEqual((await repo.restricoesAtivasPorAlvo()).map(r => r.acao).sort(), ['blacklist_adicionou', 'impedimento_adicionou']);
  const bau = (await repo.movimentoBauPorId(28)).find(l => l.id === '100');
  assert.equal(bau.entrou, 200);
  assert.equal(R.contribuicao(bau.entrou, bau.saiu).papel, 'CONTRIBUINTE');
  assert.equal((await repo.movimentoBancoPorId(28))[0].saiu, 5000);
  assert.equal((await repo.conquistasPorHora(30))[0].total, 1);
  assert.equal((await repo.entradasPorHora(30))[0].media > 0, true);

  await banco.q("UPDATE logs_jogo SET acao = 'blacklist_removeu' WHERE acao = 'blacklist_adicionou'");
  assert.deepEqual((await repo.restricoesAtivasPorAlvo()).map(r => r.acao), ['impedimento_adicionou'], 'blacklist removida não é mais ativa');
  await banco.q("UPDATE logs_jogo SET acao = 'blacklist_adicionou' WHERE acao = 'blacklist_removeu'");
});

test('funil, aprovadores e fichas: consultas de recrutamento', async () => {
  const ficha = (msg, disc, idf, status, decididoPor, criado, decidido) => banco.q(
    `INSERT INTO fichas_recrutamento (message_id, discord_id, nome, id_fivem, status, decidido_por_id, criado_em, decidido_em)
     VALUES ($1, $2, 'Nome', $3, $4, $5, $6, $7)`, [msg, disc, idf, status, decididoPor, criado, decidido]);
  await log({ acao: 'jogador_recrutou', ator: '1', alvo: '200', alvoNome: 'Novato', quando: antes(19 * DIA) });
  await ficha('f1', 'D200', '200', 'APROVADO', 'REC1', antes(20 * DIA), antes(20 * DIA - HORA));
  await ficha('f2', 'D201', '201', 'PENDENTE', null, antes(20 * HORA), null);
  await ficha('f3', 'D202', '202', 'REPROVADO', 'REC2', antes(5 * DIA), antes(5 * DIA - HORA));
  await banco.q("UPDATE fichas_recrutamento SET reprovado_categoria = 'menor de idade' WHERE message_id = 'f3'");
  await log({ acao: 'jogador_entrou', ator: '200', quando: antes(10 * DIA) }); // voltou 7+ dias depois
  await banco.q(`INSERT INTO advertencias_socio (discord_id, id_fivem, nivel, origem, log_message_id) VALUES ('D200', '200', 1, 'advertido', 'lm1')`);

  const funil = await repo.funilDeFichas(30);
  assert.deepEqual(
    [funil.fichas, funil.aprovadas, funil.recrutadas, funil.maduras7, funil.jogaram7d],
    [3, 1, 1, 1, 1],
    '3 fichas, 1 aprovada, recrutada no jogo há 19 dias e voltou a jogar 9 dias depois'
  );
  assert.equal(funil.manto_correto, 0);
  assert.deepEqual((await repo.motivosDeReprovacao(30))[0], { categoria: 'menor de idade', total: 1 });
  const aprov = (await repo.aprovadoresComProblema(60)).find(a => a.aprovador_id === 'REC1');
  assert.deepEqual([aprov.aprovados, aprov.com_problema], [1, 1], 'aprovado que tomou ADV depois conta como problema');
  const sla = R.slaDasFichas(await repo.fichasDoPeriodo(30));
  assert.equal(sla.paradas.length, 1);
  assert.deepEqual([...await repo.idsComFichaAprovada(['200', '999'])], ['200']);
});

test('varredura: reincidência avisa uma vez e de novo só se piorar', async () => {
  const resumo = (n) => [{
    socio: { discordId: 'S1', idFivem: '100' }, risco: { score: 55, nivel: 'MÉDIO' },
    dados: { reincidente: true, ocorrencias90: n, ultimaOcorrenciaEm: new Date().toISOString(), advAtivas: 1, restricoesAtivas: ['impedimento'], fatores: ['x'] },
  }];
  assert.equal(await V.alertarReincidencia(canalInt, resumo(2)), 1);
  assert.equal(await V.alertarReincidencia(canalInt, resumo(2)), 0, 'mesma contagem: não repete');
  assert.equal(await V.alertarReincidencia(canalInt, resumo(3)), 1, 'piorou: avisa');
  assert.match(textoDe(canalInt), /SÓCIO REINCIDENTE/);
  assert.match(canalInt.enviadas[0].content, new RegExp(config.lideranca[0]));
});

test('varredura: blacklist no jogo sem bloqueio no não recrutar', async () => {
  const canal = criarCanal('NR', 'nao-recrutar');
  const nomes = new Map([['700', 'Fulano Ruim'], ['600', 'Ja Bloqueado']]);
  const ativas = [{ id_fivem: '700', em: antes(DIA) }, { id_fivem: '600', em: antes(DIA) }];
  assert.equal(await V.alertarBlacklistSemBloqueio(canal, ativas, new Set(['600']), nomes), 1);
  assert.match(textoDe(canal), /700/);
  assert.doesNotMatch(textoDe(canal), /Ja Bloqueado/);
  assert.equal(await V.alertarBlacklistSemBloqueio(canal, ativas, new Set(['600']), nomes), 0, '30 dias sem repetir');
});

test('varredura: recrutou sem ficha respeita a carência de 2 h e ignora quem tem ficha', async () => {
  const canal = criarCanal('RSF', 'x');
  const agora = new Date();
  const recrutamentos = [
    { id: '800', nome: 'Sem Ficha', recrutador_id: '1', em: antes(5 * HORA) },
    { id: '801', nome: 'Com Ficha', recrutador_id: '1', em: antes(5 * HORA) },
    { id: '802', nome: 'Recente', recrutador_id: '1', em: antes(30 * 60 * 1000) },
    { id: '803', nome: 'Antigo', recrutador_id: '1', em: antes(10 * DIA) },
  ];
  const n = await V.alertarRecrutouSemFicha(canal, recrutamentos, new Set(['801']), new Map(), agora);
  assert.equal(n, 1);
  const txt = textoDe(canal);
  assert.match(txt, /Sem Ficha/);
  assert.doesNotMatch(txt, /Com Ficha|Recente|Antigo/);
});

test('varredura: ficha parada avisa uma vez por dia; sede sem vigia só sem ninguém online', async () => {
  const canal = criarCanal('FP', 'x');
  const agora = new Date();
  const fichas = [{ message_id: 'fp1', discord_id: 'D9', nome: 'Espera', id_fivem: '9', status: 'PENDENTE', criado_em: antes(20 * HORA) }];
  assert.equal(await V.alertarFichasParadas(canal, fichas, agora), 1);
  assert.equal(await V.alertarFichasParadas(canal, fichas, agora), 0);

  const fechaduras = [{ rotulo: 'SEDE', aberta: true, desde: antes(2 * HORA), por: 'Zeca' }];
  assert.equal(await V.alertarSedeSemVigia(canal, fechaduras, 5, agora), 0, 'tem gente online');
  assert.equal(await V.alertarSedeSemVigia(canal, fechaduras, 0, agora), 1);
  assert.equal(await V.alertarSedeSemVigia(canal, fechaduras, 0, agora), 0, 'mesmo destrancamento não repete');
  assert.match(textoDe(canal), /DESTRANCADO SEM NINGUÉM ONLINE/);
});

test('confiança de conduta: ADV, ADV paga, restrição e tempo de casa entram uma vez só', async () => {
  const { situacaoDe } = require('../utils/confianca/servico');
  const socio = { discordId: 'S1', idFivem: '100', membro: guild.members.cache.get('S1') };
  const dados = {
    advs: [{ id: 1, discord_id: 'S1', status: 'ATIVA' }, { id: 2, discord_id: 'S1', status: 'PAGA' }, { id: 3, discord_id: 'OUTRO', status: 'ATIVA' }],
    restricoes: [{ acao: 'impedimento_adicionou', id_fivem: '100', em: antes(3 * DIA) }, { acao: 'impedimento_adicionou', id_fivem: '555', em: antes(DIA) }],
    socios: [socio], porIdFivem: new Map([['100', socio]]), agora: new Date(),
  };
  const antesDoSinal = (await situacaoDe('S1')).score;
  const novos = await V.sincronizarConfianca(guild.client, dados);
  assert.equal(novos, 2 + 1 + 1 + 2, '2 ADV_SOCIO + 1 PAGA + 1 restrição + 2 marcos de tempo de casa (60 e 120 dias)');
  assert.equal(await V.sincronizarConfianca(guild.client, dados), 0, 'rodar de novo não pontua de novo');
  const depois = await situacaoDe('S1');
  assert.ok(depois.score >= 0 && depois.score <= 100 && antesDoSinal === 0);
  assert.ok(depois.eventos.some(e => e.sinal === 'ADV_SOCIO' && e.peso < 0));
});

test('confiança: teto negativo limita a queda e ADV vencida pesa sem janela', () => {
  const C = require('../utils/confianca/regras');
  const agora = new Date();
  const ev = (sinal, n) => Array.from({ length: n }, () => ({ sinal, peso: C.SINAIS_CONFIANCA[sinal].peso, criado_em: agora }));
  // presença dá base para a queda aparecer (o score não fica abaixo de 0)
  const base = [{ sinal: 'PRESENCA', peso: 15, criado_em: agora }, { sinal: 'PRESENCA', peso: 15, criado_em: agora }, { sinal: 'PRESENCA', peso: 15, criado_em: agora }, { sinal: 'APROVACAO', peso: 20, criado_em: agora }];
  assert.equal(C.calcularScore(base, agora), 65);
  assert.equal(C.calcularScore([...base, ...ev('ADV_SOCIO', 1)], agora), 50);
  assert.equal(C.calcularScore([...base, ...ev('ADV_SOCIO', 10)], agora), 20, 'queda limitada a 45 pontos');
  assert.equal(C.calcularScore([...base, ...ev('ADV_VENCIDA', 1)], agora), 35);
});

test('barreira de entrada: nome parecido com blacklist, não recrutar e reprovado definitivo', () => {
  const { montarAvisos } = require('../utils/inteligencia/barreira');
  const avisos = montarAvisos({
    nome: 'Zeca Urubu', idFivem: '900', restricoesDoId: ['BLACKLIST'],
    restricoes: [{ id_fivem: '10', nome: 'Zeca Urubu', rotulo: 'BLACKLIST' }, { id_fivem: '11', nome: 'Outro Nome', rotulo: 'BLACKLIST' }],
    bloqueados: [{ id_fivem: '20', nome: 'zeca  urubu' }],
    reprovados: [{ discord_id: 'D5', nome: 'Zeca Urubú' }],
  });
  assert.equal(avisos.length, 4);
  assert.match(avisos[0], /BLACKLIST/);
  assert.doesNotMatch(avisos.join(' '), /Outro Nome/);
  assert.deepEqual(montarAvisos({ nome: 'Ninguém Parecido', idFivem: '901' }), []);
  assert.equal(montarAvisos({ nome: 'Zeca Urubu', idFivem: '10', restricoes: [{ id_fivem: '10', nome: 'Zeca Urubu', rotulo: 'BLACKLIST' }] }).length, 0, 'mesmo ID já sai no aviso do ID, não como "parecido"');
});

test('barreira: ficha nova recebe resposta com o aviso; sem parecido, nada é postado', async () => {
  const { avisarNaFicha } = require('../utils/inteligencia/barreira');
  const { criarMensagem } = require('../tools/discord-falso');
  const canal = criarCanal('VS', 'validar-setagem');
  const msg = criarMensagem(canal, {});
  msg.reply = async p => canal.send(p);
  // 100 = Zeca com impedimento ativo (semeado acima), chegando de novo com o mesmo ID
  assert.equal(await avisarNaFicha({ mensagem: msg, nome: 'Zeca', idFivem: '100' }), true);
  assert.match(textoDe(canal), /IMPEDIMENTO/);
  assert.equal(await avisarNaFicha({ mensagem: msg, nome: 'Pessoa Inédita Total', idFivem: '4242' }), false);
});

test('ganchos do recrutamento: assinante roda e erro de um não derruba os outros', async () => {
  const g = require('../utils/recrutamento/ganchos');
  const chamadas = [];
  const originalErro = console.error;
  console.error = () => {};
  try {
    g.aoFichaEnviada(async () => { throw new Error('quebrou'); });
    g.aoFichaEnviada(async f => { chamadas.push(f.nome); });
    await g.emitirFichaEnviada({ nome: 'X' });
  } finally { console.error = originalErro; }
  assert.deepEqual(chamadas, ['X']);
});

test('ticket: abertura e fechamento medem a primeira resposta da equipe', async () => {
  const T = require('../utils/ticketRegistro');
  await T.abrir('T1', 'parceria', 'DONO');
  const base = Date.now();
  const canal = criarCanal('T1', 'ticket-x');
  canal.messages.fetch = async () => new Map([
    ['a', { author: { id: 'DONO', bot: false }, createdTimestamp: base - 3000 }],
    ['b', { author: { id: 'STAFF', bot: false }, createdTimestamp: base - 1000 }],
    ['c', { author: { id: 'BOT', bot: true }, createdTimestamp: base - 5000 }],
  ]);
  await T.fechar(canal, 'STAFF', 'DONO');
  const [linha] = await banco.q("SELECT primeira_resposta_em, fechado_em, fechado_por_id FROM tickets_registro WHERE canal_id = 'T1'");
  assert.equal(new Date(linha.primeira_resposta_em).getTime(), base - 1000);
  assert.equal(linha.fechado_por_id, 'STAFF');
  const resumo = await T.resumo(60);
  assert.equal(resumo[0].categoria, 'parceria');
  assert.equal(resumo[0].fechados, 1);
});

test('primeiraSaidaPorAlvo enxerga quem saiu por conta própria (ator), não só alvo', async () => {
  const logsRepo = require('../utils/logsJogo/repositorio');
  await log({ acao: 'jogador_recrutou', ator: '1', alvo: '300', alvoNome: 'Fulano', quando: antes(12 * DIA) });
  await log({ acao: 'impedimento_adicionou', ator: '1', alvo: '300', alvoNome: 'Fulano', quando: antes(5 * DIA) });
  await log({ acao: 'saiu_torcida', ator: '300', atorNome: 'Fulano', quando: antes(2 * DIA) });
  await log({ acao: 'expulso_torcida', ator: '1', alvo: '301', alvoNome: 'Outro', quando: antes(3 * DIA) });
  const saidas = await logsRepo.primeiraSaidaPorAlvo(['300', '301', '999'], ['saiu_torcida', 'expulso_torcida', 'removido_torcida_automatico']);
  assert.deepEqual(saidas.map(s => s.id).sort(), ['300', '301']);
});

test('saídas com contexto e coortes de recrutamento', async () => {
  await log({ acao: 'jogador_recrutou', ator: '1', alvo: '302', alvoNome: 'Cedo', quando: antes(40 * DIA) });
  await log({ acao: 'saiu_torcida', ator: '302', atorNome: 'Cedo', quando: antes(35 * DIA) });
  const saidas = await repo.saidasComContexto(90);
  const s300 = saidas.find(s => s.id === '300');
  assert.ok(s300.teve_restricao, 'impedimento 3 dias antes de sair');
  assert.ok(new Date(s300.recrutado_em) < new Date(s300.em));
  assert.equal(saidas.find(s => s.id === '301').recrutado_em, null, 'sem recrutamento visto: tempo de casa desconhecido');
  const perfil = R.perfilDasSaidas(saidas);
  assert.equal(perfil.total, 3);

  const coortes = await repo.coortesDeRecrutamento(150);
  const soma = campo => coortes.reduce((t, c) => t + c[campo], 0);
  assert.equal(soma('maduros7'), soma('total') - 0, 'todos os recrutados de teste têm mais de 7 dias');
  // 300 ficou 7 dias (saiu aos 10); 302 saiu aos 5 dias → não ficou; 200 recrutado há 19 dias ficou
  assert.equal(soma('ficaram7'), soma('maduros7') - 1);
  assert.equal(soma('maduros30'), 1, 'só 302 completou 30 dias, e saiu antes');
  assert.equal(soma('ficaram30'), 0);
});

test('efetividade da ADV: saída e reincidência depois da advertência', async () => {
  await banco.q(`INSERT INTO advertencias_socio (discord_id, id_fivem, nivel, origem, log_message_id, status, prazo_em, criada_em)
                  VALUES ('D300', '300', 2, 'advertido', 'lm300', 'PAGA', now() - interval '18 days', now() - interval '20 days')`);
  const linhas = await repo.advSocioEfetividade(180);
  const ef = R.efetividadeDeAdv(linhas);
  const paga = linhas.find(l => l.status === 'PAGA');
  assert.equal(paga.saiu30, true, 'saiu 18 dias depois da ADV');
  assert.equal(paga.reincidiu60, true, 'impedimento 15 dias depois da ADV');
  assert.equal(ef.taxaPagaNoPrazo, 1);
});

test('retirada atípica: alerta quem tirou 4× o próprio padrão e ignora quem sempre tira muito', async () => {
  for (let i = 0; i < 6; i++) {
    await log({ acao: 'bau_removeu', ator: '400', valor: 10, alvoNome: 'maconha', titulo: 'Retirou [Baú Sócio]', quando: antes((5 + i * 4) * DIA) });
    await log({ acao: 'bau_removeu', ator: '401', valor: 100, alvoNome: 'maconha', titulo: 'Retirou [Baú Sócio]', quando: antes((5 + i * 4) * DIA) });
  }
  await log({ acao: 'bau_removeu', ator: '400', valor: 100, alvoNome: 'maconha', titulo: 'Retirou [Baú Sócio]', quando: antes(2 * HORA) });
  await log({ acao: 'bau_removeu', ator: '401', valor: 100, alvoNome: 'maconha', titulo: 'Retirou [Baú Sócio]', quando: antes(2 * HORA) });
  const retiradas = await repo.retiradasBauRecentes(24);
  const historico = await repo.historicoDeRetiradas([...new Set(retiradas.map(x => x.id))], 24);
  const h400 = historico.find(h => h.id === '400');
  assert.deepEqual([h400.n, h400.mediana], [6, 10]);
  const canal = criarCanal('AT', 'x');
  const n = await V.alertarRetiradaAtipica(canal, retiradas, historico, new Map([['400', 'Cara Novo']]), new Map());
  assert.equal(n, 1);
  assert.match(textoDe(canal), /Cara Novo/);
  assert.doesNotMatch(textoDe(canal), /\(401\)/);
  assert.equal(await V.alertarRetiradaAtipica(canal, retiradas, historico, new Map(), new Map()), 0, 'mesma retirada não repete');
});

test('varredura: blacklist antiga não inunda, e o que passa do limite fica para a próxima', async () => {
  const canal = criarCanal('NR2', 'x');
  const agora = new Date();
  const antigas = [{ id_fivem: '9001', em: antes(100 * DIA) }];
  assert.equal(await V.alertarBlacklistSemBloqueio(canal, antigas, new Set(), new Map(), agora), 0, 'blacklist de 100 dias: outra season');
  const muitas = Array.from({ length: 25 }, (_, i) => ({ id_fivem: String(9100 + i), em: antes(DIA) }));
  assert.equal(await V.alertarBlacklistSemBloqueio(canal, muitas, new Set(), new Map(), agora), 10, 'no máximo 10 por varredura, uma mensagem por ID');
  assert.equal(canal.enviadas.length, 10);
  assert.equal(await V.alertarBlacklistSemBloqueio(canal, muitas, new Set(), new Map(), agora), 10, 'os que não couberam saem na próxima');
  assert.equal(await V.alertarBlacklistSemBloqueio(canal, muitas, new Set(), new Map(), agora), 5);
  assert.equal(await V.alertarBlacklistSemBloqueio(canal, muitas, new Set(), new Map(), agora), 0);
});

test('varredura: reincidência antiga não dispara (só a que tem ocorrência na última semana)', async () => {
  const canal = criarCanal('RE2', 'x');
  const resumo = ultima => [{
    socio: { discordId: 'S9', idFivem: '9' }, risco: { score: 40, nivel: 'MÉDIO' },
    dados: { reincidente: true, ocorrencias90: 2, ultimaOcorrenciaEm: ultima, advAtivas: 0, restricoesAtivas: [], fatores: [] },
  }];
  assert.equal(await V.alertarReincidencia(canal, resumo(antes(30 * DIA).toISOString())), 0);
  assert.equal(await V.alertarReincidencia(canal, resumo(antes(2 * DIA).toISOString())), 1);
});

test('varredura: sócio com nome de quem está restrito (com tag) e ID diferente', async () => {
  const canal = criarCanal('NRE', 'x');
  const socio = criarMembro('S7', { cargos: [config.cargos.socio], apelido: 'S | Milgrau - 7000' });
  const socios = [{ membro: socio, discordId: 'S7', idFivem: '7000', nome: 'x' }];
  const restricoes = [{ id_fivem: '7670', rotulo: 'BLACKLIST' }, { id_fivem: '7000', rotulo: 'IMPEDIMENTO' }];
  const nomes = new Map([['7670', 'Milgrau LHP'], ['7000', 'Milgrau']]);
  assert.equal(await V.alertarNomeDeRestrito(canal, socios, restricoes, nomes), 1);
  const txt = textoDe(canal);
  assert.match(txt, /7670/);
  assert.doesNotMatch(txt, /IMPEDIMENTO/, 'o próprio ID do sócio nunca conta como "outra pessoa"');
  assert.equal(await V.alertarNomeDeRestrito(canal, socios, restricoes, nomes), 0, '90 dias sem repetir');
});

test('patrimônio fora do baú, eventos com presença e horários de ficha/recrutador', async () => {
  await log({ acao: 'patrimonio_removeu', ator: '500', alvoNome: 'TOR Faixa 01', valor: 1, quando: antes(3 * DIA) });
  await log({ acao: 'patrimonio_removeu', ator: '501', alvoNome: 'Bandeira X', valor: 1, quando: antes(6 * DIA) });
  await log({ acao: 'patrimonio_guardou', ator: '501', alvoNome: 'Bandeira X', valor: 1, quando: antes(5 * DIA) });
  const fora = await repo.patrimonioForaDoBau();
  assert.deepEqual(fora.map(x => x.item), ['TOR Faixa 01'], 'a bandeira voltou; só a faixa segue fora');

  const [ev] = await banco.q("INSERT INTO eventos (titulo, inicio_em, canal_id, criado_por_id) VALUES ('Treino', now() - interval '2 days', 'c', 'x') RETURNING id");
  await banco.q("INSERT INTO evento_inscricoes (evento_id, discord_id, status, presente_em) VALUES ($1, 'S1', 'CONFIRMADO', now() - interval '2 days')", [ev.id]);
  const eventos = await repo.eventosComPresenca(30, 5);
  assert.deepEqual(eventos[0].presentes, ['S1']);
  assert.deepEqual(eventos[0].confirmados, ['S1']);

  const porHora = await repo.fichasPorHora(30);
  assert.ok(porHora.length > 0 && porHora.every(h => h.hora >= 0 && h.hora <= 23));
  assert.ok((await repo.entradasDeIdsPorHora(['100'], 30)).length > 0);
  assert.deepEqual(await repo.entradasDeIdsPorHora([], 30), []);
});

test('alerta de empréstimo de patrimônio atrasado (módulo opcional)', async () => {
  const [item] = await banco.q("INSERT INTO patrimonio_itens (nome, categoria, criado_por_id) VALUES ('Bandeira Grande', 'BANDEIRA', 'x') RETURNING id");
  await banco.q("INSERT INTO patrimonio_emprestimos (item_id, discord_id, foto_saida_ref, saiu_em, registrado_por_id) VALUES ($1, 'S1', 'foto', now() - interval '10 days', 'x')", [item.id]);
  const atrasados = await require('../utils/patrimonio/inteligencia').emprestimosAtrasados(7);
  assert.equal(atrasados.length, 1);
  const canal = criarCanal('EMP', 'x');
  assert.equal(await V.alertarEmprestimosAtrasados(canal, atrasados), 1);
  assert.match(textoDe(canal), /Bandeira Grande/);
  assert.equal(await V.alertarEmprestimosAtrasados(canal, atrasados), 0);
});

test('relatórios novos: retenção, cobertura, disciplina, patrimônio, finanças, farm e eventos conferidos', async () => {
  await banco.q("INSERT INTO financeiro_lancamentos (tipo, categoria, valor, descricao, data, criado_por_id) VALUES ('RECEITA', 'LOJA', 5000, 'venda', current_date, 'x'), ('DESPESA', 'EVENTO', 1500, 'churrasco', current_date, 'x')");
  const rel = require('../utils/inteligencia/relatorios');
  const relatoriosJogo = require('../utils/logsJogo/relatorios');
  const tempoJogadoPorId = p => relatoriosJogo.tempoJogadoPorId(p);
  const { socios } = await require('../utils/inteligencia/pessoas').carregarSocios(guild.client);

  const embeds = {
    retencao: await rel.embedRetencao(),
    cobertura: await rel.embedCobertura({ recrutadoresIds: ['1'] }),
    disciplina: await rel.embedDisciplina(),
    patrimonio: await rel.embedPatrimonio(),
    financas: await rel.embedFinancas(),
    farm: await rel.embedFarm({ tempoJogadoPorId, socios }),
    eventos: await rel.embedEventos({ socios }),
  };
  for (const [nome, e] of Object.entries(embeds)) {
    assert.ok(e.title, nome);
    assert.ok(JSON.stringify(e).length < 6000, `${nome}: embed grande demais`);
  }
  const texto = e => JSON.stringify(e);
  assert.match(texto(embeds.retencao), /COORTES/);
  assert.match(texto(embeds.retencao), /por conta própria/);
  assert.match(texto(embeds.disciplina), /saiu em 30 dias/);
  assert.match(texto(embeds.patrimonio), /TOR Faixa 01/);
  assert.match(texto(embeds.patrimonio), /Bandeira Grande/);
  assert.match(texto(embeds.financas), /LIVRO-CAIXA/);
  assert.match(texto(embeds.eventos), /PRESENÇA CONFERIDA PELO JOGO/);
  assert.match(texto(embeds.eventos), /1\/1 presentes estavam online/);
});

test('varredura completa: grava resumo por sócio, alerta e devolve o balanço', async () => {
  const saida = await V.executarVarredura(guild.client, { canais: { inteligencia: canalInt, atencao: canalInt, naoRecrutar: canalInt } });
  assert.equal(saida.resumos, 1);
  const resumo = await repo.resumoDe('S1');
  assert.equal(resumo.id_fivem, '100');
  assert.ok(resumo.risco > 0, 'impedimento ativo + ADV ativa geram risco');
  assert.ok(resumo.dados.restricoesAtivas.includes('impedimento'));
  assert.equal((await repo.maioresRiscos(10, 1))[0].discord_id, 'S1');
});

test('relatórios: todos montam embed com o banco semeado', async () => {
  const rel = require('../utils/inteligencia/relatorios');
  const relatoriosJogo = require('../utils/logsJogo/relatorios');
  const tempoJogadoPorId = p => relatoriosJogo.tempoJogadoPorId(p);
  const { socios } = await require('../utils/inteligencia/pessoas').carregarSocios(guild.client);

  const embeds = {
    risco: await rel.embedRisco({ minimo: 1 }),
    ficha: await rel.embedFichaAssociado('S1', 'De casa (55/100)'),
    semResumo: await rel.embedFichaAssociado('NAO_EXISTE'),
    esfriando: await rel.embedEsfriando(),
    recrutamento: await rel.embedRecrutamento(),
    contribuicao: await rel.embedContribuicao(),
    farm: await rel.embedFarm({ tempoJogadoPorId }),
    eventos: await rel.embedEventos(),
    territorio: await rel.embedTerritorio(),
    tickets: await rel.embedTickets(),
    departamentos: await rel.embedDepartamentos(guild.client, { tempoJogadoPorId, socios }),
    lideranca: await rel.embedLideranca(),
  };
  for (const [nome, e] of Object.entries(embeds)) {
    assert.ok(e.title, `${nome}: sem título`);
    const tamanho = JSON.stringify(e).length;
    assert.ok(tamanho < 6000, `${nome}: embed grande demais (${tamanho})`);
    assert.doesNotMatch(String(e.color), /^(65280|5763719)$/, `${nome}: cor verde proibida`);
  }
  assert.match(embeds.risco.description, /S1/);
  assert.match(embeds.ficha.description, /impedimento/);
  assert.match(embeds.recrutamento.fields.map(f => f.value).join(' '), /menor de idade/);
  assert.match(embeds.tickets.description, /parceria/);
  assert.match(embeds.contribuicao.fields.map(f => f.name).join(' '), /BAÚ/);
});

test('boletim: publica as seções e só repete depois de 7 dias', async () => {
  const B = require('../utils/inteligencia/boletim');
  const canal = criarCanal('BOL', 'boletim');
  const n = await B.publicarBoletim(guild.client, { canal });
  assert.ok(n >= 7, `seções publicadas: ${n}`);
  assert.match(canal.enviadas[0].embeds[0].title, /BOLETIM SEMANAL/);

  const agora = new Date();
  await banco.q("DELETE FROM bot_config WHERE key = 'boletim_inteligencia_ultimo'");
  await banco.q("DELETE FROM bot_config WHERE key = 'canal_inteligencia'");
  guild.channels.cache.set('BOL', canal);
  await banco.q("INSERT INTO bot_config (key, value) VALUES ('canal_inteligencia', 'BOL')");
  assert.equal(await B.publicarSeVencido(guild.client, agora), true);
  assert.equal(await B.publicarSeVencido(guild.client, new Date(agora.getTime() + 3 * DIA)), false);
  assert.equal(await B.publicarSeVencido(guild.client, new Date(agora.getTime() + 8 * DIA)), true);
});
