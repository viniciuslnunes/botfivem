// Regras puras da inteligência cruzada: reincidência, risco, contribuição, SLA, aprovadores,
// nome parecido, consistência da liderança, sede sem vigia e horas de risco.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../utils/inteligencia/regras');

const H = R.HORA_MS;
const D = R.DIA_MS;
const agora = new Date('2026-09-26T12:00:00Z');
const atras = ms => new Date(agora.getTime() - ms);

test('reincidência: 2+ ocorrências em 90 dias; a antiga não conta', () => {
  assert.equal(R.reincidencia([{ tipo: 'adv', em: atras(10 * D) }], agora).reincidente, false);
  const r = R.reincidencia([{ tipo: 'adv', em: atras(10 * D) }, { tipo: 'blacklist', em: atras(40 * D) }], agora);
  assert.equal(r.reincidente, true);
  assert.deepEqual(r.porTipo, { adv: 1, blacklist: 1 });
  assert.equal(R.reincidencia([{ tipo: 'adv', em: atras(10 * D) }, { tipo: 'adv', em: atras(200 * D) }], agora).reincidente, false);
});

test('esfriando: queda de 60% contra a média das 3 semanas anteriores, só para quem jogava o bastante', () => {
  assert.equal(R.esfriando(1 * H, 1 * H + 30 * H).esfriando, true, 'média 10h/sem → 1h');
  assert.equal(R.esfriando(8 * H, 8 * H + 30 * H).esfriando, false);
  assert.equal(R.esfriando(0, 3 * H).esfriando, false, 'média 1h/sem: pouco para medir queda');
});

test('risco do associado: soma fatores, limita em 100 e classifica', () => {
  assert.deepEqual(R.riscoDoAssociado({ advAtivas: 0, restricoesAtivas: 0 }), { score: 0, nivel: 'BAIXO', fatores: [] });
  const medio = R.riscoDoAssociado({ advAtivas: 1, pagamentoPendente: true });
  assert.equal(medio.score, 30);
  assert.equal(medio.nivel, 'MÉDIO');
  const alto = R.riscoDoAssociado({ advAtivas: 3, restricoesAtivas: 2, reincidente: true, ocorrencias90: 4, naoRecrutar: true });
  assert.equal(alto.score, 100);
  assert.equal(alto.nivel, 'ALTO');
  assert.ok(R.riscoDoAssociado({ semAtividadeDias: 20 }).fatores[0].texto.includes('20 dias'));
  assert.equal(R.riscoDoAssociado({ semAtividadeDias: 5 }).score, 0);
});

test('contribuição: papel pela razão entrou/saiu, e amostra mínima', () => {
  assert.equal(R.contribuicao(3, 2).papel, 'SEM MOVIMENTO');
  assert.equal(R.contribuicao(100, 10).papel, 'CONTRIBUINTE');
  assert.equal(R.contribuicao(100, 0).papel, 'CONTRIBUINTE');
  assert.equal(R.contribuicao(10, 100).papel, 'CONSUMIDOR');
  assert.equal(R.contribuicao(50, 50).papel, 'EQUILIBRADO');
  assert.equal(R.contribuicao(10, 100).liquido, -90);
});

test('concentração: top 3 respondendo por 70%+ com mais de 3 pessoas', () => {
  const c = R.concentracao([500, 300, 100, 50, 30, 20]);
  assert.equal(Math.round(c.participacao * 100), 90);
  assert.equal(c.alerta, true);
  assert.equal(R.concentracao([100, 100, 100]).alerta, false, 'só 3 pessoas: não há concentração a apontar');
  assert.equal(R.concentracao([100, 90, 80, 70, 60, 50]).alerta, false);
  assert.equal(R.concentracao([]).total, 0);
});

test('SLA das fichas: média, mediana e fichas paradas', () => {
  const fichas = [
    { status: 'APROVADO', criado_em: atras(30 * H), decidido_em: atras(29 * H) },
    { status: 'REPROVADO', criado_em: atras(30 * H), decidido_em: atras(26 * H) },
    { status: 'PENDENTE', criado_em: atras(20 * H) },
    { status: 'PENDENTE', criado_em: atras(2 * H) },
  ];
  const sla = R.slaDasFichas(fichas, agora);
  assert.equal(sla.decididas, 2);
  assert.equal(sla.mediaMs, 2.5 * H);
  assert.equal(sla.paradas.length, 1, 'só a de 20 h passa do limite');
  assert.equal(R.slaDasFichas([], agora).mediaMs, null);
});

test('qualidade dos aprovadores: taxa de aprovados com problema e amostra mínima', () => {
  const q = R.qualidadeDosAprovadores([
    { aprovadorId: 'A', aprovados: 10, comProblema: 4 },
    { aprovadorId: 'B', aprovados: 2, comProblema: 2 },
    { aprovadorId: 'C', aprovados: 10, comProblema: 1 },
  ]);
  assert.equal(q[0].aprovadorId, 'B');
  assert.equal(q[0].alerta, false, 'amostra pequena não alerta');
  assert.equal(q.find(l => l.aprovadorId === 'A').alerta, true);
  assert.equal(q.find(l => l.aprovadorId === 'C').alerta, false);
});

test('recrutou sem ficha: alvo do jogo sem ficha aprovada', () => {
  const r = R.recrutouSemFicha([{ id: '10' }, { id: '11' }, { id: null }], new Set(['10']));
  assert.deepEqual(r.map(x => x.id), ['11']);
});

test('funil de fichas: taxa de cada etapa, e a última só contra os recrutados maduros', () => {
  const f = R.funilDeFichas({ fichas: 100, aprovadas: 50, mantoCorreto: 40, recrutadas: 30, maduras7: 20, jogaram7d: 10 });
  assert.equal(f[0].deAnterior, null);
  assert.equal(f[1].deAnterior, 0.5);
  assert.equal(f[2].deAnterior, 0.8);
  assert.equal(f[3].deAnterior, 0.6);
  assert.equal(f[4].deAnterior, 0.5, '10 de 20 maduros, não de 30 recrutados');
  assert.equal(R.funilDeFichas({ fichas: 0, aprovadas: 0, mantoCorreto: 0, recrutadas: 0, maduras7: 0, jogaram7d: 0 })[1].deAnterior, null);
});

test('nome parecido: acha o mesmo nome com pontuação/acentos diferentes e ignora nome curto', () => {
  const candidatos = [{ nome: 'L.H.P.', id: '1' }, { nome: 'Zeca Urubu', id: '2' }];
  assert.deepEqual(R.nomesParecidos('Lhp', candidatos).map(c => c.id), ['1']);
  assert.deepEqual(R.nomesParecidos('José Silva', [{ nome: 'Jose  Silva', id: '3' }]).map(c => c.id), ['3']);
  assert.deepEqual(R.nomesParecidos('ab', [{ nome: 'ab', id: '4' }]), []);
  // o jogo põe tag no nome: mesmo nome com tag é a mesma pessoa; nome curto solto não vale
  assert.deepEqual(R.nomesParecidos('Milgrau', [{ nome: 'Milgrau LHP', id: '5' }]).map(c => c.id), ['5']);
  assert.deepEqual(R.nomesParecidos('Mkzin RSJ', [{ nome: 'Mkzin', id: '6' }]).map(c => c.id), ['6']);
  assert.deepEqual(R.nomesParecidos('Lucas', [{ nome: 'Lucas Silva', id: '7' }]), [], 'nome de 5 letras dentro de outro: coincidência');
  assert.deepEqual(R.nomesParecidos('Completamente Outro', candidatos), []);
});

test('consistência da liderança: remoção rápida pelo mesmo ator e rajada de promoções', () => {
  const t = min => new Date(agora.getTime() + min * 60 * 1000).toISOString();
  const restricoes = [
    { acao: 'impedimento_adicionou', ator_id_fivem: '1', alvo_id_fivem: '9', ocorrido_em: t(0) },
    { acao: 'impedimento_removeu', ator_id_fivem: '1', alvo_id_fivem: '9', ocorrido_em: t(5) },
    { acao: 'blacklist_adicionou', ator_id_fivem: '2', alvo_id_fivem: '8', ocorrido_em: t(0) },
    { acao: 'blacklist_removeu', ator_id_fivem: '2', alvo_id_fivem: '8', ocorrido_em: t(600) },
    { acao: 'impedimento_adicionou', ator_id_fivem: '3', alvo_id_fivem: '7', ocorrido_em: t(0) },
    { acao: 'impedimento_removeu', ator_id_fivem: '4', alvo_id_fivem: '7', ocorrido_em: t(2) },
  ];
  const promocoes = Array.from({ length: 5 }, (_, i) => ({ ator_id_fivem: '5', ocorrido_em: t(i) }));
  const r = R.consistenciaDaLideranca(restricoes, promocoes);
  const por = id => r.find(l => l.id === id);
  assert.equal(por('1').removeuRapido, 1);
  assert.equal(por('2').removeuRapido, 0, 'remoção depois de 10 h é normal');
  assert.equal(por('4').removeuRapido, 0, 'outro ator desfazendo não é "mudou de ideia"');
  assert.equal(por('5').promocoesEmRajada, 1);
  assert.deepEqual(r.filter(l => l.alerta).map(l => l.id).sort(), ['1', '5']);
});

test('sede sem vigia: destrancada há mais de 30 min e ninguém online', () => {
  const fech = [{ rotulo: 'SEDE', aberta: true, desde: atras(45 * 60 * 1000) }, { rotulo: 'PORTÃO', aberta: false, desde: atras(D) }];
  assert.deepEqual(R.fechaduraSemVigia(fech, 0, agora).map(f => f.rotulo), ['SEDE']);
  assert.deepEqual(R.fechaduraSemVigia(fech, 3, agora), [], 'tem gente online');
  assert.deepEqual(R.fechaduraSemVigia([{ rotulo: 'SEDE', aberta: true, desde: atras(10 * 60 * 1000) }], 0, agora), []);
  assert.deepEqual(R.fechaduraSemVigia([{ rotulo: 'SEDE', aberta: null, desde: null }], 0, agora), []);
});

test('horas de risco no território: conquistou com pouca gente online', () => {
  const perdas = [{ hora: 3, total: 5 }, { hora: 21, total: 6 }, { hora: 4, total: 1 }];
  const ocupacao = [{ hora: 3, media: 2 }, { hora: 4, media: 2 }, { hora: 21, media: 30 }];
  const risco = R.horasDeRisco(perdas, ocupacao);
  assert.deepEqual(risco.map(h => h.hora), [3, 4], '21h tem muita gente: não é falta de defesa');
});

test('perfil das saídas: tempo de casa, tipo e quem teve problema antes', () => {
  const t = d => new Date(agora.getTime() - d * D);
  const p = R.perfilDasSaidas([
    { acao: 'saiu_torcida', em: t(1), recrutado_em: t(4), teve_restricao: false, teve_adv: false },
    { acao: 'expulso_torcida', em: t(1), recrutado_em: t(20), teve_restricao: true, teve_adv: false },
    { acao: 'removido_torcida_automatico', em: t(1), recrutado_em: t(200), teve_restricao: false, teve_adv: true },
    { acao: 'saiu_torcida', em: t(1), recrutado_em: null, teve_restricao: false, teve_adv: false },
  ]);
  assert.equal(p.total, 4);
  assert.equal(p.comProblema, 2);
  assert.deepEqual(Object.fromEntries(p.faixas), { 'menos de 7 dias': 1, '7 a 30 dias': 1, 'mais de 90 dias': 1, 'sem data de entrada': 1 });
  assert.deepEqual(p.porTipo, { saiu_torcida: 2, expulso_torcida: 1, removido_torcida_automatico: 1 });
});

test('coortes: retenção só sobre os maduros', () => {
  const [c] = R.retencaoDasCoortes([{ mes: '2026-08', total: 10, maduros7: 8, ficaram7: 6, maduros30: 0, ficaram30: 0 }]);
  assert.equal(c.d7, 0.75);
  assert.equal(c.d30, null, 'ninguém completou 30 dias ainda: não inventa taxa');
});

test('cobertura: hora com ficha acima da média e recrutador abaixo de metade da média', () => {
  const fichas = [{ hora: 20, media: 4 }, { hora: 3, media: 0.2 }, { hora: 14, media: 3 }];
  const recrutadores = [{ hora: 20, media: 0.1 }, { hora: 14, media: 6 }, { hora: 3, media: 0 }];
  const b = R.buracosDeCobertura(fichas, recrutadores);
  assert.deepEqual(b.map(x => x.hora), [20], '14h tem recrutador; 3h quase não tem ficha');
});

test('efetividade da ADV: pagamento no prazo, saída e reincidência', () => {
  const ef = R.efetividadeDeAdv([
    { status: 'PAGA', prazo_em: new Date(), registrado_por: '111', saiu30: false, reincidiu60: false },
    { status: 'VENCIDA', prazo_em: new Date(), registrado_por: '111', saiu30: true, reincidiu60: true },
    { status: 'ATIVA', prazo_em: null, registrado_por: null, saiu30: false, reincidiu60: true },
  ]);
  assert.equal(ef.total, 3);
  assert.equal(ef.taxaPagaNoPrazo, 0.5, 'só as que exigem pagamento entram');
  assert.equal(Math.round(ef.taxaSaiu30 * 100), 33);
  assert.equal(Math.round(ef.taxaReincidiu60 * 100), 67);
  assert.deepEqual(ef.aplicadores[0], { id: '111', total: 2 });
  assert.equal(R.efetividadeDeAdv([]).taxaSaiu30, null);
});

test('retirada atípica: compara a pessoa com ela mesma e exige histórico', () => {
  assert.equal(R.retiradaAtipica({ quantidade: 100 }, { n: 8, mediana: 10 }), true);
  assert.equal(R.retiradaAtipica({ quantidade: 100 }, { n: 8, mediana: 100 }), false, 'quem sempre tira muito não dispara');
  assert.equal(R.retiradaAtipica({ quantidade: 100 }, { n: 2, mediana: 10 }), false, 'sem histórico não julga');
  assert.equal(R.retiradaAtipica({ quantidade: 15 }, { n: 8, mediana: 1 }), false, 'quantidade pequena não vale alerta');
  assert.equal(R.retiradaAtipica({ quantidade: 100 }, null), false);
});

test('farm: cargo sem produção, produção sem cargo e cargo sem ID', () => {
  const membros = [{ discordId: 'A', idFivem: '1' }, { discordId: 'B', idFivem: '2' }, { discordId: 'C', idFivem: null }];
  const r2 = R.farmCargoVsProducao(membros, new Map([['1', 500], ['9', 300], ['8', 0]]));
  assert.deepEqual(r2.semProducao.map(m => m.discordId), ['B']);
  assert.deepEqual(r2.semId.map(m => m.discordId), ['C']);
  assert.deepEqual(r2.producaoSemCargo, [{ id: '9', quantidade: 300 }]);
});

test('presença conferida: presentes que estavam online no jogo', () => {
  const c = R.presencaConferida(['1', '2', null, '3'], new Set(['1', '3']));
  assert.deepEqual([c.conferiveis, c.noJogo], [3, 2], 'quem não tem ID no apelido não dá para conferir');
  assert.equal(R.presencaConferida([], new Set()).taxa, null);
});
