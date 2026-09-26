// Mérito de recrutadores: regras puras + fluxo ponta a ponta (ciclo 0 de calibração,
// ciclo valendo com indicação, fraude, votação, veto, decisão, dispensa e lembretes)
// em Postgres real em memória e Discord falso. Nada toca o banco de verdade.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_SSL = 'off';
const { instalarBanco } = require('../tools/banco-em-memoria');
const { criarMembro, criarServidor, criarInteracao } = require('../tools/discord-falso');
const R = require('../utils/merito/regras');

const DIA = R.DIA_MS;
const HORA = R.HORA_MS;
// Relativo ao relógio real: a votação precisa seguir aberta quando os botões (que usam a hora de verdade) são clicados
const BASE = new Date(Date.now() - 100 * DIA);
const T0 = new Date(Date.UTC(BASE.getUTCFullYear(), BASE.getUTCMonth(), BASE.getUTCDate(), 3, 0, 0)); // início do ciclo 0 (meia-noite de Brasília)
const C1 = new Date(T0.getTime() + 56 * DIA); // início do ciclo 1
const C2 = new Date(C1.getTime() + 56 * DIA); // início do ciclo 2

// ── Regras puras ─────────────────────────────────────────────────────────────

const ciclo = { inicio: T0 };
const bruto = (extra = {}) => ({
  recrutador: 'REC', recrutado: `A${Math.random()}`, ocorridoEm: new Date(T0.getTime() + 2 * DIA),
  recrutadorNome: 'Rec Um', recrutadoNome: 'Fulano de Tal', fantasma: false, saiuCedo: false, problema: false, aprovado: false, bloqueadoEm: null, ...extra,
});

test('ciclo: 8 semanas de 7 dias, semanaDe e fim', () => {
  const d = R.datasDoCiclo(T0);
  assert.equal(d.semanas.length, 8);
  assert.equal(d.fim.getTime(), T0.getTime() + 56 * DIA);
  assert.equal(R.semanaDe(ciclo, T0), 0);
  assert.equal(R.semanaDe(ciclo, new Date(T0.getTime() + 7 * DIA)), 1);
  assert.equal(R.semanaDe(ciclo, new Date(T0.getTime() - 1)), -1);
  assert.equal(R.semanaDe(ciclo, d.fim), -1);
  assert.equal(R.cicloEncerrado(ciclo, d.fim), true);
  assert.equal(R.cicloEncerrado(ciclo, new Date(d.fim - 1)), false);
});

test('validade: pendente, suspeito, válido e inválido conforme a idade e o que o recrutado fez', () => {
  const ocorridoEm = new Date(T0);
  const em = dias => new Date(T0.getTime() + dias * DIA);
  const estado = (extra, dias) => R.classificarRecrutamento({ ocorridoEm, fantasma: false, saiuCedo: false, problema: false, aprovado: false, ...extra }, em(dias)).estado;
  assert.equal(estado({}, 1), 'pendente');
  assert.equal(estado({ fantasma: true }, 1), 'pendente', 'muito novo para dizer que sumiu');
  assert.equal(estado({ fantasma: true }, 4), 'suspeito');
  assert.equal(estado({}, 14), 'valido');
  assert.equal(estado({ fantasma: true }, 14), 'invalido');
  assert.equal(estado({ fantasma: true, aprovado: true }, 14), 'valido', 'aprovado como sócio vale mesmo sem log');
  assert.equal(estado({ saiuCedo: true }, 1), 'invalido');
  assert.equal(estado({ problema: true }, 30), 'invalido');
});

test('preparar: mesmo alvo conta uma vez, bloqueado e círculo fechado não passam limpos', () => {
  const agora = new Date(T0.getTime() + 60 * DIA);
  const { itens, fraudes } = R.prepararRecrutamentos([
    bruto({ recrutado: 'X1' }), bruto({ recrutado: 'X1', ocorridoEm: new Date(T0.getTime() + 3 * DIA), recrutador: 'OUTRO' }),
    bruto({ recrutado: 'B1', bloqueadoEm: new Date(T0.getTime() - DIA) }),
    bruto({ recrutado: 'C1', recrutadoNome: 'Rec Um' }),
  ], { agora });
  assert.equal(itens.filter(i => i.recrutado === 'X1').map(i => i.estado).sort().join(), 'duplicado,valido');
  assert.equal(itens.find(i => i.recrutado === 'B1').estado, 'invalido');
  assert.equal(itens.find(i => i.recrutado === 'C1').estado, 'retido');
  assert.deepEqual(fraudes.map(f => f.tipo).sort(), ['alvo_bloqueado', 'circulo']);
});

test('preparar: rajada de 6 recrutamentos em 1 h, a maioria fantasma, é retida; a decisão da liderança muda o destino', () => {
  const agora = new Date(T0.getTime() + 60 * DIA);
  const lote = () => Array.from({ length: 6 }, (_, i) => bruto({ recrutado: `R${i}`, fantasma: true, ocorridoEm: new Date(T0.getTime() + 5 * DIA + i * 5 * 60000) }));
  const pendente = R.prepararRecrutamentos(lote(), { agora });
  assert.equal(pendente.fraudes.filter(f => f.tipo === 'rajada').length, 1);
  assert.ok(pendente.itens.every(i => i.estado === 'retido'));
  const chave = pendente.fraudes[0].chave;
  const liberado = R.prepararRecrutamentos(lote(), { agora, decisoes: new Map([[`REC|${chave}`, 'APROVADA']]) });
  assert.ok(liberado.itens.every(i => i.estado === 'invalido'), 'liberado volta à regra normal: fantasma antigo é inválido');
  const negado = R.prepararRecrutamentos(lote(), { agora, decisoes: new Map([[`REC|${chave}`, 'NEGADA']]) });
  assert.ok(negado.itens.every(i => i.estado === 'invalido' && /descartado/.test(i.motivo)));
  const espaçado = R.prepararRecrutamentos(Array.from({ length: 6 }, (_, i) => bruto({ recrutado: `E${i}`, fantasma: true, ocorridoEm: new Date(T0.getTime() + 5 * DIA + i * 2 * HORA) })), { agora });
  assert.equal(espaçado.fraudes.length, 0, '6 em 12 horas não é rajada');
});

const semanasPara = (efetivosPorSemana, extra = {}) => R.agregarSemanas(
  efetivosPorSemana.flatMap((n, s) => Array.from({ length: n }, (_, i) => ({
    recrutador: 'REC', recrutado: `S${s}-${i}`, ocorridoEm: new Date(T0.getTime() + s * 7 * DIA + DIA + i * 2 * HORA), estado: 'valido',
  }))),
  { ciclo, meta: 10, piso: 20, agora: new Date(T0.getTime() + 60 * DIA), ...extra }
);

test('semanas: meta batida, dispensada, fora da conta e meta reduzida em semana fraca', () => {
  const s = semanasPara([10, 9, 12, 0, 10, 10, 10, 10], { dispensadas: new Set([1]) });
  assert.equal(s.filter(x => x.bateu).length, 6);
  assert.equal(s[1].contavel, false, 'dispensada sai da conta');
  assert.equal(s[3].contavel, true);
  assert.equal(R.maiorSequencia(s), 4, 'a dispensada não quebra a sequência: semanas 4 a 7');

  const novato = semanasPara([10, 10, 10, 10, 10, 10, 10, 10], { cargoDesde: new Date(T0.getTime() + 20 * DIA) });
  assert.deepEqual(novato.map(x => x.foraDaConta), [true, true, true, false, false, false, false, false], 'semanas parciais antes do cargo ficam fora');

  assert.equal(R.metaAjustada(10, 5, 20, true), 3, 'novatos abaixo do piso reduzem a meta na proporção');
  assert.equal(R.metaAjustada(10, 5, 20, false), 10, 'sem dado de novatos a meta não muda');
  assert.equal(R.metaAjustada(10, 0, 20, true), 1, 'mínimo 1');
  assert.equal(semanasPara([3], { novatosPorSemana: [6, 0, 0, 0, 0, 0, 0, 0], piso: 20 })[0].meta, 3);
});

test('semanas: pico muito acima do próprio padrão só avisa', () => {
  const s = semanasPara([10, 10, 10, 10, 10, 40, 10, 10]);
  assert.deepEqual(R.picos(s).map(p => p.semana), [5]);
  assert.deepEqual(R.picos(semanasPara([10, 10])), [], 'poucas semanas não têm padrão');
});

const dadosMax = (extra = {}) => ({
  semanas: semanasPara([10, 10, 10, 10, 10, 10, 10, 10]), totais: { maduros: 10, ficaram: 10, aprovados: 10 },
  manto: { avaliados: 5, corretos: 5 }, fichas: { aprovadas: 5, completas: 5 }, engajamento: { eventos: 4, presentes: 4 },
  advCiclo: 0, cargoDesde: new Date(T0.getTime() - 100 * DIA), advAtivaNivel: 0, risco: 0, agora: new Date(T0.getTime() + 60 * DIA), ...extra,
});

test('pontuação: 100 no máximo; amostra pequena vale meio; ADV desconta; bônus fica fora dos 100', () => {
  assert.equal(R.pontuar(dadosMax()).pontos, 100);
  const pequena = R.pontuar(dadosMax({ totais: { maduros: 2, ficaram: 0, aprovados: 0 } }));
  assert.equal(pequena.detalhe.qualidade, R.PESOS.qualidade / 2, 'neutro: metade do peso, não zero');
  assert.equal(pequena.detalhe.neutros.qualidade, true);
  assert.equal(R.pontuar(dadosMax({ advCiclo: 2 })).pontos, 80);
  const metade = R.pontuar(dadosMax({ semanas: semanasPara([10, 10, 10, 10, 0, 0, 0, 0]) }));
  assert.equal(metade.detalhe.constancia, 20);
  assert.equal(metade.semanasBatidas, 4);
  const evolucao = R.pontuar(dadosMax({ anterior: { pontos: 50, teveAdv: true } }));
  assert.equal(evolucao.bonus, 5, 'evolução (3) + retorno de ADV (2)');
  assert.equal(evolucao.pontos, 100);
  assert.equal(R.pontuar(dadosMax({ semanas: semanasPara([0, 0, 0, 0, 0, 0, 0, 0]) })).semanasBatidas, 0);
});

test('elegibilidade: cargo novo, poucas semanas, ADV 2+, risco alto e lote em revisão barram', () => {
  const el = extra => {
    const d = dadosMax(extra);
    return R.elegibilidade(d, R.pontuar(d));
  };
  assert.equal(el({}).elegivel, true);
  assert.match(el({ cargoDesde: new Date(T0.getTime() + 50 * DIA) }).motivos.join(), /semanas no cargo/);
  assert.match(el({ semanas: semanasPara([10, 10, 10, 0, 0, 0, 0, 0]) }).motivos.join(), /bateu a meta em 3 de 8/);
  assert.match(el({ advAtivaNivel: 2 }).motivos.join(), /advertência ativa/);
  assert.equal(el({ advAtivaNivel: 1 }).elegivel, true, '1ª advertência não barra');
  assert.match(el({ risco: 70 }).motivos.join(), /risco alto/);
  assert.match(el({ emRevisao: true }).motivos.join(), /revisão/);
});

test('ranking: elegíveis primeiro, desempate por recrutamentos e menos ADV; empate no 3º entra junto', () => {
  const l = (id, pontos, efetivos, extra = {}) => ({ discordId: id, pontos, bonus: 0, efetivos, elegivel: true, advCiclo: 0, cargoDesde: new Date(T0), semanasBatidas: 5, ...extra });
  const r = R.ranquear([l('c', 80, 30), l('a', 90, 10), l('b', 80, 40), l('x', 99, 50, { elegivel: false }), l('d', 80, 30)]);
  assert.deepEqual(r.map(x => x.discordId), ['a', 'b', 'c', 'd', 'x']);
  assert.deepEqual(r.map(x => x.posicao), [1, 2, 3, 4, null]);
  const indicados = R.selecionarIndicados(r).map(x => x.discordId);
  assert.deepEqual(indicados, ['a', 'b', 'c', 'd'], 'c e d empatam no 3º: os dois entram');
  const selos = R.selosDoCiclo(r, R.selecionarIndicados(r));
  assert.ok(selos.some(s => s.discordId === 'a' && s.selo === 'DESTAQUE') && selos.some(s => s.discordId === 'x' && s.selo === 'CONSTANTE') === false);
  assert.ok(R.selosDoCiclo([l('z', 50, 5, { semanasBatidas: 6 })], []).some(s => s.selo === 'CONSTANTE'));
});

test('votação: quórum de maioria, abstenção, veto, empate e prorrogação uma vez', () => {
  const base = { indicados: ['a', 'b', 'c'], total: 5 };
  const ap = (votos, vetos = []) => R.apurarVotacao({ ...base, votos: votos.map(([v, i]) => ({ votanteId: v, indicadoId: i })), vetos });
  const ganha = ap([['1', 'a'], ['2', 'a'], ['3', 'b'], ['4', null]]);
  assert.equal(ganha.quorum, 3);
  assert.equal(ganha.quorumOk, true);
  assert.equal(ganha.recomendado, 'a');
  assert.equal(ap([['1', 'a'], ['2', 'b'], ['3', null]]).empate, true);
  assert.equal(ap([['1', 'a'], ['2', 'a']]).quorumOk, false);
  const veto = ap([['1', 'a'], ['2', 'a'], ['3', 'b']], [{ indicadoId: 'a' }]);
  assert.deepEqual(veto.vetados, ['a']);
  assert.equal(veto.recomendado, 'b', 'vetado sai da disputa');
  const agora = new Date('2026-05-10T00:00:00Z');
  const ate = new Date('2026-05-09T00:00:00Z');
  assert.equal(R.situacaoDaVotacao({ agora, votacaoAte: new Date('2026-05-11T00:00:00Z'), prorrogada: false, apuracao: ganha }), 'aberta');
  assert.equal(R.situacaoDaVotacao({ agora, votacaoAte: ate, prorrogada: false, apuracao: ganha }), 'encerrar');
  const semQuorum = ap([['1', 'a']]);
  assert.equal(R.situacaoDaVotacao({ agora, votacaoAte: ate, prorrogada: false, apuracao: semQuorum }), 'prorrogar');
  assert.equal(R.situacaoDaVotacao({ agora, votacaoAte: ate, prorrogada: true, apuracao: semQuorum }), 'encerrar_sem_quorum');
});

test('ritmo da semana: quanto falta e quantos dias restam', () => {
  const s = semanasPara([4, 0, 0, 0, 0, 0, 0, 0], { agora: new Date(T0.getTime() + 4 * DIA) })[0];
  const r = R.ritmoDaSemana(s, new Date(T0.getTime() + 4 * DIA));
  assert.deepEqual([r.faltam, r.diasRestantes, r.bateu], [6, 3, false]);
});

// ── Fluxo ponta a ponta ──────────────────────────────────────────────────────

let banco;
let config;
let repo;
let S;
let P;
let guild;
let membros;
let fontes1;
const DATA = { agora0: new Date(C1.getTime() + DIA), agora1: new Date(C2.getTime() + DIA) };

const fivem = { R1: '11', R2: '22', R3: '33', R4: '44', R5: '55' };
const linhas = (id, cicloInicio, semanas, porSemana = 3) => semanas.flatMap(s => Array.from({ length: porSemana }, (_, i) => ({
  recrutador: id, recrutado: `${id}-${cicloInicio.getTime()}-${s}-${i}`, recrutadoNome: `Recruta ${id} ${s} ${i}`,
  ocorridoEm: new Date(cicloInicio.getTime() + s * 7 * DIA + DIA + i * 3 * HORA),
})));
const rajada = (id, cicloInicio) => Array.from({ length: 6 }, (_, i) => ({
  recrutador: id, recrutado: `${id}-rajada-${i}`, recrutadoNome: `Fantasma ${i}`, ocorridoEm: new Date(cicloInicio.getTime() + 8 * DIA + i * 5 * 60000),
}));
const semDados = { recrutamentos: [], fantasmas: [], problemas: [], saidas: [], aprovados: new Set() };

test.before(async () => {
  banco = await instalarBanco();
  config = require('../config/index.js');
  repo = require('../utils/merito/repositorio');
  S = require('../utils/merito/servico');
  P = require('../utils/merito/paineis');
  require('../plataforma').carregarModulos({ commands: null });

  const rec = (id, nome) => criarMembro(id, { cargos: [config.cargos.recrutador], apelido: `R GDF | ${nome} - ${fivem[id]}` });
  membros = {
    R1: rec('R1', 'Um'), R2: rec('R2', 'Dois'), R3: rec('R3', 'Tres'), R4: rec('R4', 'Quatro'), R5: rec('R5', 'Cinco'),
    L1: criarMembro('L1', { cargos: [config.cargos.presidente], nome: 'Presidente' }),
    L2: criarMembro('L2', { cargos: [config.cargos.vicePresidente], nome: 'Vice' }),
    L3: criarMembro('L3', { cargos: [config.cargos.diretoria], nome: 'Diretor' }),
    S1: criarMembro('S1', { cargos: [config.cargos.socio], nome: 'Socio' }),
  };
  guild = criarServidor({ membros: Object.values(membros) });
  await banco.q("INSERT INTO recrutadores_cargo (discord_id, desde) SELECT x, '2025-01-01' FROM unnest($1::text[]) x", [['R1', 'R2', 'R3', 'R4', 'R5']]);
  await banco.q('INSERT INTO bot_config (key, value) VALUES ($1, $2), ($3, $4)', ['merito_ciclo_inicio', T0.toISOString(), 'merito_meta_semanal', '3']);

  // Ciclo 1: R1 constante (8 semanas), R2 6, R3 4, R4 abaixo da meta, R5 rajada de fantasmas
  const recR1 = linhas('11', C1, [0, 1, 2, 3, 4, 5, 6, 7]);
  const recR2 = linhas('22', C1, [0, 1, 2, 3, 4, 5]);
  fontes1 = {
    recrutamentos: [...recR1, ...recR2, ...linhas('33', C1, [0, 1, 2, 3]), ...linhas('44', C1, [0, 1, 2, 3, 4, 5, 6, 7], 1), ...rajada('55', C1)],
    fantasmas: rajada('55', C1).map(r => ({ recrutador: '55', alvo: r.recrutado })),
    problemas: [], saidas: [],
    aprovados: new Set([...recR1, ...recR2].map(r => r.recrutado)),
  };
  // Manto e ficha de R1 no ciclo 1 (SQL de verdade)
  for (let i = 0; i < 5; i++) {
    await banco.q(
      `INSERT INTO fichas_recrutamento (message_id, discord_id, nome, idade, id_fivem, telefone, status, decidido_por_id, decidido_em, criado_em)
       VALUES ($1, $2, 'Nome', 20, $3, '11999999999', 'APROVADO', 'R1', $4, $5)`,
      [`F${i}`, `C${i}`, `9${i}`, new Date(C1.getTime() + 10 * DIA), new Date(C1.getTime() + 9 * DIA)]
    );
    await banco.q(
      "INSERT INTO mantos_avaliados (message_id, candidato_id, enviado_em, resultado, avaliado_em) VALUES ($1, $2, $3, 'CORRETO', $4)",
      [`M${i}`, `C${i}`, new Date(C1.getTime() + 9 * DIA + HORA), new Date(C1.getTime() + 10 * DIA)]
    );
  }
});
test.after(async () => { await banco.pglite.close(); });

const emDia = async () => true;
const todasEnviadas = () => guild.channels.cache.map(c => c.enviadas).flat();
const textoDoCanal = () => JSON.stringify(todasEnviadas().map(m => [m.content, m.embeds]));
const clicar = (customId, membro, extras = {}) => {
  const i = criarInteracao({ customId, membro, guild, ...extras });
  return require('../utils/modulos').despacharInteracao(i).then(() => i);
};

test('ciclo 0 é de calibração: fecha sem indicar, abre o ciclo 1 com a meta congelada e avisa a liderança', async () => {
  const antes = await S.garantirCiclo(new Date(T0.getTime() + DIA));
  assert.equal(antes.numero, 0);
  assert.equal(antes.sombra, true);
  assert.deepEqual(antes.config, { meta: 3, piso: 20 });

  const r = await S.atualizarParcial(guild.client, { agora: DATA.agora0, fontes: semDados, fonteEmDia: emDia });
  assert.equal(r.ciclo.numero, 1, 'o ciclo 0 fechou e o 1 abriu');
  const c0 = await repo.buscarCiclo(antes.id);
  assert.equal(c0.status, 'FECHADO');
  assert.equal(c0.votacao_ate, null, 'sombra não abre votação');
  assert.equal((await repo.resultadosDoCiclo(c0.id)).filter(x => x.indicado).length, 0);
  assert.match(textoDoCanal(), /CALIBRAÇÃO DO MÉRITO/);
  assert.equal((await repo.cicloAberto()).numero, 1);
  assert.equal(await S.fecharCiclo(guild.client, c0, { agora: DATA.agora0, fontes: null, fonteEmDia: emDia }), null, 'fechar de novo não duplica');
});

test('ciclo 1: pendência de fraude segura o fechamento; só a liderança decide, uma vez só', async () => {
  const aberto = await repo.cicloAberto();
  assert.equal(await S.fecharCiclo(guild.client, aberto, { agora: DATA.agora1, fontes: fontes1, fonteEmDia: emDia }), null);
  assert.equal((await repo.buscarCiclo(aberto.id)).status, 'ABERTO', 'ranking congelado só depois das pendências');
  assert.match(textoDoCanal(), /terminou, mas tem \*\*1\*\* pendência/);

  const pendentes = await repo.revisoesPendentes(aberto.id);
  assert.equal(pendentes.length, 1);
  assert.deepEqual([pendentes[0].tipo, pendentes[0].discord_id], ['rajada', 'R5']);
  const painel = JSON.stringify(await P.montarBlocosVotacao());
  assert.match(painel, /PENDÊNCIAS DA LIDERANÇA \(1\)/);
  assert.match(painel, /rajada de recrutamentos suspeita/);

  const pend = pendentes[0];
  assert.match((await clicar('merito:pendencias', membros.S1)).texto(), /APENAS A LIDERAN/);
  assert.match((await clicar('merito:pendencias', membros.L2)).texto(), /ESCOLHA A PENDÊNCIA/);
  assert.match((await clicar('merito:pend_sel', membros.L2, { tipo: 'select', valores: [String(pend.id)] })).texto(), /DESCARTAR/);
  const decidida = await clicar(`merito:pend_dec:${pend.id}`, membros.L2, { tipo: 'select', valores: ['NEGADA'] });
  assert.match(decidida.texto(), /PENDÊNCIA DECIDIDA/);
  assert.match((await clicar(`merito:pend_dec:${pend.id}`, membros.L1, { tipo: 'select', valores: ['APROVADA'] })).texto(), /JÁ FOI DECIDIDA/, 'clique duplo não decide de novo');
  await S.aguardarRecalculo();
  assert.equal((await repo.buscarRevisao(pend.id)).status, 'NEGADA');
  assert.equal((await repo.decisoesDeFraude(aberto.id)).get(`R5|${pend.chave}`), 'NEGADA');
});

test('ciclo 1: fecha, ranqueia, indica o top 3 e abre a votação', async () => {
  const aberto = await repo.cicloAberto();
  const fechado = await S.fecharCiclo(guild.client, aberto, { agora: DATA.agora1, fontes: fontes1, fonteEmDia: emDia });
  assert.equal(fechado.status, 'EM_VOTACAO');
  assert.ok(new Date(fechado.votacao_ate) > new Date(), 'a votação segue aberta no relógio real');

  const res = await repo.resultadosDoCiclo(fechado.id);
  const por = id => res.find(r => r.discord_id === id);
  assert.deepEqual(res.filter(r => r.indicado).map(r => r.discord_id).sort(), ['R1', 'R2', 'R3']);
  assert.deepEqual(['R1', 'R2', 'R3'].map(id => por(id).posicao), [1, 2, 3]);
  assert.ok(por('R1').pontos > por('R2').pontos && por('R2').pontos > por('R3').pontos);
  assert.equal(por('R4').elegivel, false, 'nunca bateu a meta');
  assert.match(por('R4').motivos.join(), /bateu a meta em 0 de 8/);
  assert.equal(por('R5').elegivel, false);
  assert.equal(por('R5').posicao, null);
  assert.equal(por('R5').detalhe.totais.brutos, 6, 'o lote descartado foi contado e reprovado, não sumiu');

  // As duas últimas semanas de R1 ainda são presumidas (dentro dos 14 dias) e contam
  const semanasR1 = await repo.semanasDe(fechado.id, 'R1');
  assert.equal(semanasR1.length, 8);
  assert.ok(semanasR1.every(s => s.bateu));
  assert.equal(semanasR1[7].pendentes, 3);

  // Qualidade, manto e ficha entram no detalhe (SQL de verdade)
  assert.equal(por('R1').detalhe.manto.corretos, 5);
  assert.equal(por('R1').detalhe.fichas.completas, 5);
  assert.ok(por('R1').detalhe.pontos.manto === 10 && por('R1').detalhe.pontos.ficha === 5);

  // Selos: destaque para o top 3, constante para quem bateu 6+ semanas
  assert.deepEqual((await repo.selosDe('R1')).map(s => s.selo).sort(), ['CONSTANTE', 'DESTAQUE']);
  assert.deepEqual((await repo.selosDe('R3')).map(s => s.selo), ['DESTAQUE']);

  // Aviso à liderança: menção no content e dossiê dos indicados
  const aviso = todasEnviadas().find(m => /do mérito fechado/.test(m.content ?? ''));
  assert.ok(aviso, 'aviso de fechamento');
  assert.ok(aviso.content.includes(`<@&${config.lideranca[0]}>`));
  assert.equal(aviso.embeds.length, 3);
  assert.equal((await repo.cicloAberto()).numero, 2, 'o ciclo seguinte abriu na hora');
  assert.equal(await S.fecharCiclo(guild.client, aberto, { agora: DATA.agora1, fontes: fontes1, fonteEmDia: emDia }), null, 'fechar de novo não duplica');
});

test('painéis: ranking só lê o que foi gravado; votação esconde o placar', async () => {
  const ranking = JSON.stringify(await P.montarBlocosMerito(DATA.agora1));
  assert.match(ranking, /MÉRITO DE RECRUTADORES/);
  assert.match(ranking, /AINDA FORA DO RANKING/);
  const votacao = JSON.stringify(await P.montarBlocosVotacao());
  assert.match(votacao, /VOTAÇÃO DO MÉRITO · CICLO 1/);
  assert.match(votacao, /placar fica oculto/);
  assert.match(votacao, /Constância 40,0/);
  assert.ok(!/voto\(s\)/.test(votacao), 'nenhum placar por indicado durante a votação');
});

test('voto: só liderança, um por pessoa (troca), abstenção, veto só da presidência e placar oculto', async () => {
  const c1 = await repo.cicloEmVotacao();
  const comum = await clicar(`merito:votar:${c1.id}:R1`, membros.S1);
  assert.match(comum.texto(), /APENAS A LIDERAN/);

  const l1 = await clicar(`merito:votar:${c1.id}:R2`, membros.L1);
  assert.match(l1.texto(), /VOTO REGISTRADO/);
  assert.doesNotMatch(l1.texto(), /R2/, 'a resposta não revela placar');
  await clicar(`merito:votar:${c1.id}:R1`, membros.L1); // troca
  await clicar(`merito:votar:${c1.id}:R1`, membros.L2);
  assert.match((await clicar(`merito:votar:${c1.id}:0`, membros.L3)).texto(), /ABSTENÇÃO/);
  const votos = await repo.votosDoCiclo(c1.id);
  assert.equal(votos.length, 3);
  assert.equal(votos.find(v => v.votanteId === 'L1').indicadoId, 'R1');
  assert.match((await clicar(`merito:votar:${c1.id}:R5`, membros.L2)).texto(), /NÃO É INDICADO/);

  // Veto: diretoria não pode; presidência precisa de motivo, e só uma vez por indicado
  assert.match((await clicar('merito:vetar', membros.L3)).texto(), /APENAS A PRESIDÊNCIA/);
  assert.match((await clicar('merito:vetar', membros.L1)).texto(), /QUAL INDICADO/);
  const curto = await clicar(`merito:vetar_modal:${c1.id}:R3`, membros.L1, { tipo: 'modal', campos: { motivo: 'ruim' } });
  assert.match(curto.texto(), /MÍNIMO 10/);
  const ok = await clicar(`merito:vetar_modal:${c1.id}:R3`, membros.L1, { tipo: 'modal', campos: { motivo: 'conduta questionável no grupo' } });
  assert.match(ok.texto(), /VETO REGISTRADO/);
  assert.match((await clicar(`merito:vetar_modal:${c1.id}:R3`, membros.L2, { tipo: 'modal', campos: { motivo: 'outro motivo qualquer' } })).texto(), /JÁ ESTÁ VETADO/);
  assert.match((await clicar(`merito:votar:${c1.id}:R3`, membros.L2)).texto(), /VETADO/);
});

test('encerrar votação: com quórum conclui e indica; decisão final só da presidência e só depois de concluída', async () => {
  const c1 = await repo.cicloEmVotacao();
  assert.match((await clicar('merito:decisao', membros.L1)).texto(), /NENHUMA VOTAÇÃO ENCERRADA/);

  assert.deepEqual(await S.encerrarVotacao(guild.client, c1.id, { agora: new Date() }), { situacao: 'aberta' });
  const fim = new Date(new Date(c1.votacao_ate).getTime() + HORA);
  const r = await S.encerrarVotacao(guild.client, c1.id, { agora: fim });
  assert.equal(r.situacao, 'encerrar');
  assert.equal(r.apuracao.quorumOk, true);
  assert.equal(r.apuracao.recomendado, 'R1');
  assert.deepEqual(r.apuracao.vetados, ['R3']);
  assert.equal((await repo.buscarCiclo(c1.id)).status, 'CONCLUIDO');
  assert.equal(await S.encerrarVotacao(guild.client, c1.id, { agora: fim }), null, 'encerrar de novo não repete');
  assert.match(textoDoCanal(), /Indicação da votação/);

  assert.match((await clicar('merito:decisao', membros.L3)).texto(), /APENAS A PRESIDÊNCIA/);
  assert.match((await clicar('merito:decisao', membros.L1)).texto(), /REGISTRAR DECISÃO DO CICLO 1/);
  const feito = await clicar('merito:decisao_sel', membros.L1, { tipo: 'select', valores: [`PROMOVIDO:${c1.id}:R1`] });
  assert.match(feito.texto(), /DECISÃO REGISTRADA: PROMOVIDO/);
  assert.equal((await repo.resultadoDe(c1.id, 'R1')).decisao, 'PROMOVIDO');
  assert.match((await clicar('merito:decisao_sel', membros.L1, { tipo: 'select', valores: [`PROMOVIDO:${c1.id}:R4`] })).texto(), /NÃO É INDICADO/);
});

test('sem quórum no prazo: prorroga uma vez e depois encerra sem quórum', async () => {
  const cicloTeste = await repo.criarCiclo({ numero: 90, inicio: T0, fim: T0, sombra: false, versaoRegras: 1, config: {} });
  await repo.gravarResultados(cicloTeste.id, [{ discordId: 'R1', pontos: 90, bonus: 0, posicao: 1, elegivel: true, motivos: [], indicado: true, detalhe: { nome: 'Um' } }]);
  const ate = new Date(Date.now() + DIA);
  await banco.q("UPDATE merito_ciclos SET status = 'EM_VOTACAO', votacao_ate = $2 WHERE id = $1", [cicloTeste.id, ate]);
  await repo.votar(cicloTeste.id, 'L1', 'R1'); // 1 de 3: sem quórum

  const depois = new Date(ate.getTime() + HORA);
  assert.equal((await S.encerrarVotacao(guild.client, cicloTeste.id, { agora: depois })).situacao, 'prorrogar');
  const prorrogado = await repo.buscarCiclo(cicloTeste.id);
  assert.equal(prorrogado.prorrogada, true);
  assert.ok(new Date(prorrogado.votacao_ate) > depois);
  const tarde = new Date(new Date(prorrogado.votacao_ate).getTime() + HORA);
  const fim = await S.encerrarVotacao(guild.client, cicloTeste.id, { agora: tarde });
  assert.equal(fim.situacao, 'encerrar_sem_quorum');
  assert.match(textoDoCanal(), /Sem quórum/);
  assert.equal((await repo.buscarCiclo(cicloTeste.id)).status, 'CONCLUIDO');
});

test('semana dispensada: 1 por ciclo, só semana que já começou, liderança aprova e a semana sai da conta', async () => {
  const agora = new Date(C2.getTime() + 10 * DIA);
  const c2 = await repo.cicloAberto();
  assert.equal(c2.numero, 2);
  const pedido = await S.pedirDispensa(guild.client, { discordId: 'R2', semana: 0, motivo: 'viagem de família', agora });
  assert.equal(pedido.ok, true);
  assert.equal((await S.pedirDispensa(guild.client, { discordId: 'R2', semana: 1, motivo: 'de novo', agora })).ok, false, 'só 1 por ciclo');
  assert.match((await S.pedirDispensa(guild.client, { discordId: 'R3', semana: 5, motivo: 'semana futura', agora })).mensagem, /JÁ COMEÇOU/);
  assert.equal((await repo.buscarRevisao(pedido.revisao.id)).tipo, 'dispensa');

  const antes = await S.calcular(guild.client, c2, { agora, fontes: semDados });
  assert.equal(antes.ranking.find(r => r.discordId === 'R2').semanas[0].dispensada, false, 'pedido pendente ainda não vale');

  const decisao = await clicar(`merito:pend_dec:${pedido.revisao.id}`, membros.L2, { tipo: 'select', valores: ['APROVADA'] });
  assert.match(decisao.texto(), /PENDÊNCIA DECIDIDA/);
  await S.aguardarRecalculo();
  const depois = await S.calcular(guild.client, c2, { agora, fontes: semDados });
  const s0 = depois.ranking.find(r => r.discordId === 'R2').semanas[0];
  assert.equal(s0.dispensada, true);
  assert.equal(s0.contavel, false);
  assert.ok(membros.R2.dms.some(d => /foi dispensada/.test(d.content)), 'recrutador é avisado por DM');
});

test('modal de dispensa exige motivo e a permissão é conferida de novo', async () => {
  const semRec = await clicar('merito:dispensa_modal:1', membros.S1, { tipo: 'modal', campos: { motivo: 'motivo longo o bastante' } });
  assert.match(semRec.texto(), /SÓ RECRUTADORES/);
  const curto = await clicar('merito:dispensa_modal:1', membros.R3, { tipo: 'modal', campos: { motivo: 'curto' } });
  assert.match(curto.texto(), /PELO MENOS 10/);
});

test('lembretes: quinta avisa quem não bateu a meta, quem bateu recebe parabéns, e não repete; calibração não manda', async () => {
  let quinta = new Date(C2.getTime() + 7 * DIA + 12 * HORA); // semana 2 do ciclo 2
  while (new Date(quinta.getTime() - 3 * HORA).getUTCDay() !== 4) quinta = new Date(quinta.getTime() + DIA);
  const c2 = await repo.cicloAberto();
  const fontes = { ...semDados, recrutamentos: [...linhas('11', C2, [1], 3), ...linhas('44', C2, [1], 1)] };
  const { coleta } = await S.calcular(guild.client, c2, { agora: quinta, fontes });
  membros.R1.dms.length = 0;
  membros.R4.dms.length = 0;
  await S.enviarLembretes(guild.client, c2, coleta, quinta);
  assert.ok(membros.R1.dms.some(d => /bateu a meta da semana/.test(d.content)));
  assert.ok(membros.R4.dms.some(d => /Faltam \*\*2\*\* recrutamento/.test(d.content)));
  const [n1, n4] = [membros.R1.dms.length, membros.R4.dms.length];
  await S.enviarLembretes(guild.client, c2, coleta, quinta);
  assert.equal(membros.R1.dms.length, n1, 'não repete a comemoração');
  assert.equal(membros.R4.dms.length, n4, 'não repete o lembrete');
  await S.enviarLembretes(guild.client, { ...c2, sombra: true }, coleta, new Date(quinta.getTime() + 7 * DIA));
  assert.equal(membros.R4.dms.length, n4, 'ciclo de calibração não manda lembrete');
});

test('extrato pessoal, comando /merito e seção de regras no quadro dos recrutadores', async () => {
  const { payloadExtrato } = require('../utils/merito/interacoes');
  const ext = await payloadExtrato('R1', 'Um');
  assert.equal(ext.flags, 64);
  assert.match(JSON.stringify(ext), /MEU MÉRITO/);

  const cmd = require('../commands/merito');
  const outro = { id: 'R1', username: 'Um' };
  const i = criarInteracao({ customId: 'x', membro: membros.R2, guild });
  i.options = { getUser: () => outro };
  await cmd.execute(i);
  assert.match(i.texto(), /LIDERAN/, 'recrutador comum não vê o extrato de outro');

  const j = criarInteracao({ customId: 'x', membro: membros.L1, guild });
  j.options = { getUser: () => outro };
  await cmd.execute(j);
  assert.match(j.texto(), /MEU MÉRITO/);

  const regras = JSON.stringify(require('../utils/advertenciaRecrutadorAuto/paineis').blocosRegras());
  assert.match(regras, /MÉRITO: COMO SE CHEGA A GESTOR/);
  assert.match(regras, /8 semanas/);
});

test('ajuste de regras: só presidência, valida o número e vale no próximo ciclo', async () => {
  assert.match((await clicar('merito:config', membros.L3)).texto(), /APENAS A PRESIDÊNCIA/);
  assert.match((await clicar('merito:config', membros.L1)).texto(), /próximo ciclo/);
  const ruim = await clicar('merito:cfg_modal:merito_meta_semanal', membros.L1, { tipo: 'modal', campos: { valor: 'abc' } });
  assert.match(ruim.texto(), /NÚMERO INTEIRO/);
  const ok = await clicar('merito:cfg_modal:merito_meta_semanal', membros.L1, { tipo: 'modal', campos: { valor: '12' } });
  assert.match(ok.texto(), /META SEMANAL[^]*12/);
  assert.equal((await S.lerRegrasAtuais()).meta, 12);
  assert.equal((await repo.cicloAberto()).config.meta, 3, 'o ciclo aberto não muda no meio');
});

test('fonte de logs parada: o ciclo não fecha e a liderança é avisada uma vez por dia', async () => {
  const aberto = await repo.cicloAberto();
  const depois = new Date(new Date(aberto.fim).getTime() + DIA);
  const avisos = () => todasEnviadas().filter(m => /fonte de logs do jogo está parada/.test(m.content ?? '')).length;
  const antes = avisos();
  assert.equal(await S.fecharCiclo(guild.client, aberto, { agora: depois, fontes: null, fonteEmDia: async () => false }), null);
  assert.equal((await repo.buscarCiclo(aberto.id)).status, 'ABERTO');
  assert.equal(avisos(), antes + 1);
  await S.fecharCiclo(guild.client, aberto, { agora: depois, fontes: null, fonteEmDia: async () => false });
  assert.equal(avisos(), antes + 1, 'não avisa de novo no mesmo dia');
});
