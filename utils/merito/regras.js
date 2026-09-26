// Mérito de recrutadores: regras PURAS (sem Discord, sem banco). Tudo que decide
// pontos, elegibilidade, fraude e votação mora aqui e é coberto por
// test/merito.test.js. Contrato: docs/contratos/regras-negocio.md (seção Mérito).
const { similaridade, normalizarNome } = require('../nomes');

const DIA_MS = 24 * 60 * 60 * 1000;
const HORA_MS = 60 * 60 * 1000;

// Muda quando pesos ou critérios mudam; o ciclo grava a versão que usou.
const VERSAO_REGRAS = 1;

const LIMITES = {
  semanasCiclo: 8,
  metaPadrao: 10, // recrutamentos efetivos por semana
  pisoNovatosPadrao: 20, // novatos na semana abaixo disso reduzem a meta na proporção
  janelaValidacaoDias: 14, // recrutado só é confirmado depois disso
  suspeitoDias: 3, // sem nenhuma atividade depois disso = suspeito (não conta até voltar)
  minSemanasCargo: 4,
  minSemanasBatidas: 4,
  minAmostraQualidade: 5, // abaixo disso o critério de % vale meio (neutro)
  minAmostraFicha: 3,
  minEventosEngajamento: 2,
  semanasDispensadasPorCiclo: 1,
  rajada: { minimo: 6, janelaMs: HORA_MS, maioriaRuim: 0.5 },
  picoFator: 3,
  picoMinSemanas: 4,
  nomeParecido: 0.85,
  riscoAlto: 60, // associado_resumo.risco a partir daqui barra a indicação
  seloConstanteSemanas: 6,
  indicados: 3,
  votacaoDias: 7,
  prorrogacaoDias: 3,
  lembreteDiaSemana: 4, // quinta (0 = domingo)
  gracaRevisaoDias: 3, // o ciclo espera pendência de fraude/dispensa por até isto antes de fechar
};

const PESOS = {
  constancia: 40, sequencia: 5, qualidade: 25, conversao: 10, manto: 10, ficha: 5, engajamento: 5,
};
const DESCONTO_ADV = 10;
const BONUS_MAXIMO = 5;

// ── Ciclo e semanas ──────────────────────────────────────────────────────────

function datasDoCiclo(inicio) {
  const ini = new Date(inicio);
  const semanas = Array.from({ length: LIMITES.semanasCiclo }, (_, i) => ({
    indice: i,
    inicio: new Date(ini.getTime() + i * 7 * DIA_MS),
    fim: new Date(ini.getTime() + (i + 1) * 7 * DIA_MS),
  }));
  return { inicio: ini, fim: new Date(ini.getTime() + LIMITES.semanasCiclo * 7 * DIA_MS), semanas };
}

function semanaDe(ciclo, data) {
  const t = new Date(data).getTime();
  const { inicio, fim } = datasDoCiclo(ciclo.inicio);
  if (t < inicio.getTime() || t >= fim.getTime()) return -1;
  return Math.floor((t - inicio.getTime()) / (7 * DIA_MS));
}

function cicloEncerrado(ciclo, agora = new Date()) {
  return new Date(agora).getTime() >= datasDoCiclo(ciclo.inicio).fim.getTime();
}

// Semana fraca do servidor: poucos novatos reduzem a meta na proporção (mínimo 1).
// Sem dado de novatos no ciclo inteiro, a meta não é mexida.
function metaAjustada(meta, novatosNaSemana, piso, haDadoDeNovatos) {
  if (!haDadoDeNovatos || !piso || novatosNaSemana >= piso) return meta;
  return Math.max(1, Math.ceil(meta * (novatosNaSemana / piso)));
}

// ── Validade do recrutamento ─────────────────────────────────────────────────

// r: { ocorridoEm, fantasma, saiuCedo, problema, aprovado }
// estados: valido · pendente (presumido válido, ainda dentro da janela) ·
//          suspeito (sumiu; não conta até voltar) · invalido
function classificarRecrutamento(r, agora = new Date()) {
  const idadeMs = new Date(agora).getTime() - new Date(r.ocorridoEm).getTime();
  if (r.saiuCedo) return { estado: 'invalido', motivo: 'saiu cedo' };
  if (r.problema) return { estado: 'invalido', motivo: 'advertência, bloqueio ou impedimento depois de recrutado' };
  const voltou = !r.fantasma || r.aprovado;
  if (idadeMs >= LIMITES.janelaValidacaoDias * DIA_MS) {
    return voltou ? { estado: 'valido', motivo: null } : { estado: 'invalido', motivo: 'nunca mais apareceu' };
  }
  if (!voltou && idadeMs >= LIMITES.suspeitoDias * DIA_MS) return { estado: 'suspeito', motivo: 'sem atividade desde o recrutamento' };
  return { estado: 'pendente', motivo: null };
}

const ruim = (r, agora) => r.saiuCedo || r.problema
  || (r.fantasma && !r.aprovado && new Date(agora) - new Date(r.ocorridoEm) >= LIMITES.suspeitoDias * DIA_MS);

// Classifica todos os recrutamentos do ciclo e separa o que a liderança precisa olhar.
// brutos: [{ recrutador, recrutado, ocorridoEm, recrutadoNome, recrutadorNome, fantasma,
//            saiuCedo, problema, aprovado, bloqueadoEm }]
// decisoes: Map chave → 'APROVADA' | 'NEGADA' | 'PENDENTE' (revisões já tomadas)
// Devolve { itens: [{...bruto, estado, motivo, chave}], fraudes: [{ tipo, chave, recrutador, retem, detalhe }] }
function prepararRecrutamentos(brutos, { agora = new Date(), decisoes = new Map() } = {}) {
  const ordenados = [...brutos].sort((a, b) => new Date(a.ocorridoEm) - new Date(b.ocorridoEm));
  const fraudes = [];
  const vistos = new Set();
  const itens = ordenados.map(b => {
    const base = { ...b, ...classificarRecrutamento(b, agora), chave: null };
    // Mesmo recrutado 2+ vezes no ciclo (por qualquer recrutador) conta uma vez só
    if (vistos.has(b.recrutado)) return { ...base, estado: 'duplicado', motivo: 'mesmo ID já recrutado no ciclo' };
    vistos.add(b.recrutado);
    // Recrutado que já estava em NÃO RECRUTAR quando foi recrutado
    if (b.bloqueadoEm && new Date(b.bloqueadoEm) <= new Date(b.ocorridoEm)) {
      const chave = `bloqueado:${b.recrutado}`;
      fraudes.push({ tipo: 'alvo_bloqueado', chave, recrutador: b.recrutador, retem: false, detalhe: { recrutado: b.recrutado } });
      return { ...base, estado: 'invalido', motivo: 'ID estava em NÃO RECRUTAR', chave };
    }
    // Recrutado com nome parecido ao do próprio recrutador: círculo fechado
    if (b.recrutadorNome && b.recrutadoNome) {
      const a = normalizarNome(b.recrutadorNome);
      const c = normalizarNome(b.recrutadoNome);
      if (a.length >= 3 && c.length >= 3 && similaridade(a, c) >= LIMITES.nomeParecido) {
        const chave = `circulo:${b.recrutado}`;
        fraudes.push({ tipo: 'circulo', chave, recrutador: b.recrutador, retem: true, detalhe: { recrutado: b.recrutado, nome: b.recrutadoNome } });
        return { ...base, chave, retencao: true };
      }
    }
    return base;
  });

  // Rajada: N+ recrutamentos em 1 hora, a maioria "ruim"
  const porRecrutador = new Map();
  for (const it of itens) {
    if (!porRecrutador.has(it.recrutador)) porRecrutador.set(it.recrutador, []);
    porRecrutador.get(it.recrutador).push(it);
  }
  for (const [recrutador, lista] of porRecrutador) {
    for (let i = 0; i < lista.length;) {
      let j = i;
      while (j + 1 < lista.length && new Date(lista[j + 1].ocorridoEm) - new Date(lista[i].ocorridoEm) <= LIMITES.rajada.janelaMs) j++;
      const janela = lista.slice(i, j + 1);
      if (janela.length >= LIMITES.rajada.minimo
        && janela.filter(x => ruim(x, agora)).length / janela.length > LIMITES.rajada.maioriaRuim) {
        const chave = `rajada:${new Date(janela[0].ocorridoEm).toISOString().slice(0, 13)}`;
        fraudes.push({ tipo: 'rajada', chave, recrutador, retem: true, detalhe: { quantidade: janela.length, em: janela[0].ocorridoEm } });
        for (const x of janela) { x.chave = chave; x.retencao = true; }
        i = j + 1;
      } else {
        i++;
      }
    }
  }

  // Aplica a decisão da liderança nos lotes retidos
  for (const it of itens) {
    if (!it.retencao) continue;
    const decisao = decisoes.get(`${it.recrutador}|${it.chave}`) ?? 'PENDENTE';
    if (decisao === 'NEGADA') { it.estado = 'invalido'; it.motivo = 'lote descartado pela liderança'; } else if (decisao === 'PENDENTE') {
      it.estadoOriginal = it.estado; it.estado = 'retido'; it.motivo = 'em revisão da liderança';
    }
  }
  return { itens, fraudes };
}

const efetivo = estado => estado === 'valido' || estado === 'pendente';

// ── Semanas ──────────────────────────────────────────────────────────────────

const mediana = valores => {
  if (!valores.length) return 0;
  const o = [...valores].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};

// itens: recrutamentos classificados de UM recrutador
// ctx: { ciclo, meta, novatosPorSemana: number[]|null, piso, dispensadas: Set<indice>, cargoDesde, agora }
function agregarSemanas(itens, ctx) {
  const { ciclo, meta, novatosPorSemana = null, piso, dispensadas = new Set(), cargoDesde = null } = ctx;
  const agora = new Date(ctx.agora ?? new Date());
  const haNovatos = Boolean(novatosPorSemana?.some(n => n > 0));
  const { semanas } = datasDoCiclo(ciclo.inicio);
  return semanas.map(s => {
    const doPeriodo = itens.filter(i => semanaDe(ciclo, i.ocorridoEm) === s.indice);
    const conta = estado => doPeriodo.filter(i => i.estado === estado).length;
    const futura = s.inicio > agora;
    const emAndamento = !futura && s.fim > agora;
    const foraDaConta = Boolean(cargoDesde) && new Date(cargoDesde) > s.inicio;
    const metaSemana = metaAjustada(meta, novatosPorSemana?.[s.indice] ?? 0, piso, haNovatos);
    const efetivos = doPeriodo.filter(i => efetivo(i.estado)).length;
    const dispensada = dispensadas.has(s.indice);
    return {
      indice: s.indice, inicio: s.inicio, fim: s.fim,
      brutos: doPeriodo.length, validos: conta('valido'), pendentes: conta('pendente'),
      suspeitos: conta('suspeito'), retidos: conta('retido'), invalidos: conta('invalido') + conta('duplicado'),
      efetivos, meta: metaSemana, futura, emAndamento, foraDaConta, dispensada,
      contavel: !futura && !emAndamento && !foraDaConta && !dispensada,
      bateu: efetivos >= metaSemana,
    };
  });
}

// Semana muito acima do padrão do próprio recrutador: só informa a liderança.
function picos(semanas) {
  const contaveis = semanas.filter(s => s.contavel);
  if (contaveis.length < LIMITES.picoMinSemanas) return [];
  const m = mediana(contaveis.map(s => s.efetivos));
  if (m <= 0) return [];
  return contaveis.filter(s => s.efetivos > LIMITES.picoFator * m && s.bateu).map(s => ({ semana: s.indice, efetivos: s.efetivos, mediana: m }));
}

function maiorSequencia(semanas) {
  let atual = 0;
  let maior = 0;
  for (const s of semanas) {
    if (!s.contavel) { if (!s.foraDaConta && !s.dispensada) atual = 0; continue; }
    atual = s.bateu ? atual + 1 : 0;
    maior = Math.max(maior, atual);
  }
  return maior;
}

// ── Pontuação ────────────────────────────────────────────────────────────────

const arred = n => Math.round(n * 10) / 10;
// percentual com amostra mínima: abaixo dela vale metade do peso (neutro, não zera)
function pontosPct(parte, total, minimo, peso) {
  if (total < minimo) return { pontos: peso / 2, neutro: true, parte, total };
  return { pontos: (parte / total) * peso, neutro: false, parte, total };
}

// d: { semanas, totais:{maduros, ficaram, aprovados}, manto:{avaliados, corretos},
//      fichas:{aprovadas, completas}, engajamento:{eventos, presentes}, advCiclo, anterior }
function pontuar(d) {
  const contaveis = d.semanas.filter(s => s.contavel);
  const batidas = contaveis.filter(s => s.bateu).length;
  const sequencia = maiorSequencia(d.semanas);
  const constancia = contaveis.length ? (batidas / contaveis.length) * PESOS.constancia : 0;
  const seq = contaveis.length ? (sequencia / contaveis.length) * PESOS.sequencia : 0;
  const qualidade = pontosPct(d.totais.ficaram, d.totais.maduros, LIMITES.minAmostraQualidade, PESOS.qualidade);
  const conversao = pontosPct(d.totais.aprovados, d.totais.maduros, LIMITES.minAmostraQualidade, PESOS.conversao);
  const manto = pontosPct(d.manto.corretos, d.manto.avaliados, LIMITES.minAmostraFicha, PESOS.manto);
  const ficha = pontosPct(d.fichas.completas, d.fichas.aprovadas, LIMITES.minAmostraFicha, PESOS.ficha);
  const engaj = pontosPct(Math.min(d.engajamento.presentes, d.engajamento.eventos), d.engajamento.eventos, LIMITES.minEventosEngajamento, PESOS.engajamento);
  const disciplina = -DESCONTO_ADV * (d.advCiclo ?? 0);
  const bonus = bonusTrajetoria(d.anterior, { advCiclo: d.advCiclo ?? 0, pontosBase: constancia + seq + qualidade.pontos + conversao.pontos + manto.pontos + ficha.pontos + engaj.pontos + disciplina });
  const total = constancia + seq + qualidade.pontos + conversao.pontos + manto.pontos + ficha.pontos + engaj.pontos + disciplina;
  return {
    pontos: arred(Math.max(0, total)),
    bonus: arred(bonus.total),
    semanasBatidas: batidas, semanasContaveis: contaveis.length, maiorSequencia: sequencia,
    detalhe: {
      constancia: arred(constancia), sequencia: arred(seq), qualidade: arred(qualidade.pontos), conversao: arred(conversao.pontos),
      manto: arred(manto.pontos), ficha: arred(ficha.pontos), engajamento: arred(engaj.pontos), disciplina,
      neutros: { qualidade: qualidade.neutro, conversao: conversao.neutro, manto: manto.neutro, ficha: ficha.neutro, engajamento: engaj.neutro },
      bonus: bonus.itens,
    },
  };
}

// Evolução (até 3): mais pontos que o ciclo anterior; retorno (2): teve ADV antes, ciclo limpo agora.
function bonusTrajetoria(anterior, { advCiclo, pontosBase }) {
  const itens = [];
  if (!anterior) return { total: 0, itens };
  if (anterior.pontos > 0 && pontosBase >= anterior.pontos * 1.1) itens.push({ nome: 'evolução', pontos: 3 });
  if (anterior.teveAdv && advCiclo === 0) itens.push({ nome: 'retorno', pontos: 2 });
  return { total: Math.min(BONUS_MAXIMO, itens.reduce((s, i) => s + i.pontos, 0)), itens };
}

function elegibilidade(d, resultado) {
  const motivos = [];
  if (!d.cargoDesde) motivos.push('sem data de cargo de recrutador');
  else if (new Date(d.agora ?? new Date()) - new Date(d.cargoDesde) < LIMITES.minSemanasCargo * 7 * DIA_MS) motivos.push(`menos de ${LIMITES.minSemanasCargo} semanas no cargo`);
  if (resultado.semanasBatidas < LIMITES.minSemanasBatidas) motivos.push(`bateu a meta em ${resultado.semanasBatidas} de ${LIMITES.semanasCiclo} semanas (mínimo ${LIMITES.minSemanasBatidas})`);
  if ((d.advAtivaNivel ?? 0) >= 2) motivos.push('advertência ativa de 2ª ou mais');
  if (d.perdeuCargo) motivos.push('perdeu o cargo de recrutador no ciclo');
  if ((d.risco ?? 0) >= LIMITES.riscoAlto) motivos.push('risco alto na inteligência cruzada');
  if (d.emRevisao) motivos.push('lote em revisão da liderança');
  return { elegivel: motivos.length === 0, motivos };
}

// Ranking: elegíveis primeiro (posição 1..n), depois inelegíveis por pontos (sem posição).
// Desempate: mais recrutamentos efetivos, menos ADV, cargo mais antigo.
function ranquear(linhas) {
  const cmp = (a, b) => (b.pontos + b.bonus) - (a.pontos + a.bonus)
    || b.efetivos - a.efetivos
    || (a.advCiclo ?? 0) - (b.advCiclo ?? 0)
    || new Date(a.cargoDesde ?? 0) - new Date(b.cargoDesde ?? 0);
  const elegiveis = linhas.filter(l => l.elegivel).sort(cmp);
  const inelegiveis = linhas.filter(l => !l.elegivel).sort(cmp);
  return [
    ...elegiveis.map((l, i) => ({ ...l, posicao: i + 1 })),
    ...inelegiveis.map(l => ({ ...l, posicao: null })),
  ];
}

// Top N com empate no último lugar: todos os empatados entram
function selecionarIndicados(ranking, n = LIMITES.indicados) {
  const elegiveis = ranking.filter(r => r.posicao);
  if (elegiveis.length <= n) return elegiveis;
  const corte = elegiveis[n - 1];
  const nota = r => arred(r.pontos + r.bonus);
  return elegiveis.filter(r => r.posicao <= n || (nota(r) === nota(corte) && r.efetivos === corte.efetivos));
}

function selosDoCiclo(ranking, indicados) {
  const selos = [];
  const ids = new Set(indicados.map(i => i.discordId));
  for (const r of ranking) {
    if (ids.has(r.discordId)) selos.push({ discordId: r.discordId, selo: 'DESTAQUE' });
    if (r.semanasBatidas >= LIMITES.seloConstanteSemanas) selos.push({ discordId: r.discordId, selo: 'CONSTANTE' });
  }
  return selos;
}

// ── Ritmo da semana (lembretes) ──────────────────────────────────────────────

function ritmoDaSemana(semana, agora = new Date()) {
  if (!semana || semana.futura) return null;
  const diasRestantes = Math.max(0, Math.ceil((semana.fim - new Date(agora)) / DIA_MS));
  const faltam = Math.max(0, semana.meta - semana.efetivos);
  return { faltam, diasRestantes, bateu: faltam === 0, meta: semana.meta, efetivos: semana.efetivos };
}

// ── Votação ──────────────────────────────────────────────────────────────────

// indicados: [discordId]; votos: [{ votanteId, indicadoId|null (abstenção) }];
// vetos: [{ indicadoId }]; total: quantos da liderança podem votar
function apurarVotacao({ indicados, votos, vetos = [], total }) {
  const quorum = Math.floor(total / 2) + 1;
  const validos = votos.filter(v => v.indicadoId);
  const contagem = new Map(indicados.map(id => [id, 0]));
  for (const v of validos) if (contagem.has(v.indicadoId)) contagem.set(v.indicadoId, contagem.get(v.indicadoId) + 1);
  const vetados = new Set(vetos.map(v => v.indicadoId));
  const disputa = [...contagem].filter(([id]) => !vetados.has(id));
  const maior = disputa.length ? Math.max(...disputa.map(([, n]) => n)) : 0;
  const lideres = disputa.filter(([, n]) => n === maior && maior > 0).map(([id]) => id);
  return {
    quorum, participacao: votos.length, quorumOk: votos.length >= quorum,
    contagem: Object.fromEntries(contagem), vetados: [...vetados],
    vencedores: lideres, empate: lideres.length > 1,
    recomendado: lideres.length === 1 ? lideres[0] : null,
  };
}

// Sem quórum no prazo: prorroga uma vez; depois encerra "sem quórum"
function situacaoDaVotacao({ agora = new Date(), votacaoAte, prorrogada, apuracao }) {
  if (new Date(agora) < new Date(votacaoAte)) return 'aberta';
  if (apuracao.quorumOk) return 'encerrar';
  return prorrogada ? 'encerrar_sem_quorum' : 'prorrogar';
}

module.exports = {
  DIA_MS, HORA_MS, VERSAO_REGRAS, LIMITES, PESOS, DESCONTO_ADV, BONUS_MAXIMO,
  datasDoCiclo, semanaDe, cicloEncerrado, metaAjustada,
  classificarRecrutamento, prepararRecrutamentos, efetivo,
  agregarSemanas, picos, maiorSequencia, mediana,
  pontuar, bonusTrajetoria, elegibilidade, ranquear, selecionarIndicados, selosDoCiclo,
  ritmoDaSemana, apurarVotacao, situacaoDaVotacao,
};
