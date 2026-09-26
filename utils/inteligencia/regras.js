// Regras puras da inteligência cruzada (sem Discord nem banco). Cada função recebe dados já
// lidos e devolve uma conclusão que só INFORMA: quem decide o que fazer é a liderança
// (docs/contratos/regras-negocio.md § Inteligência cruzada).
const { normalizarNome, similaridade } = require('../nomes');

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;

const LIMITES = Object.freeze({
  reincidenciaDias: 90,
  reincidenciaMinimo: 2,
  esfriandoQueda: 0.6, // caiu 60% ou mais contra a média das 3 semanas anteriores
  esfriandoMediaMinMs: 3 * HORA_MS, // só conta quem jogava pelo menos 3 h por semana
  fichaParadaHoras: 12,
  aprovadorJanelaDias: 60,
  aprovadorAmostraMinima: 3,
  aprovadorTaxaAlerta: 0.3,
  nomeParecido: 0.8,
  sedeAbertaMinutos: 30,
  removeuRapidoMs: 10 * 60 * 1000,
  promocoesEmRajada: 5,
  contribuicaoMinimo: 10,
  concentracaoTop: 3,
  concentracaoAlerta: 0.7,
});

// ── Reincidência ─────────────────────────────────────────────────────────────

// ocorrencias: [{ tipo, em }] — ADV de sócio, blacklist, suspensão e impedimento do mesmo
// associado. Reincidente = 2 ou mais dentro da janela.
function reincidencia(ocorrencias, agora = new Date()) {
  const limite = agora.getTime() - LIMITES.reincidenciaDias * DIA_MS;
  const recentes = ocorrencias.filter(o => new Date(o.em).getTime() >= limite);
  const porTipo = {};
  for (const o of recentes) porTipo[o.tipo] = (porTipo[o.tipo] ?? 0) + 1;
  const ultima = recentes.reduce((m, o) => Math.max(m, new Date(o.em).getTime()), 0);
  return { total: recentes.length, porTipo, ultimaEm: ultima ? new Date(ultima) : null, reincidente: recentes.length >= LIMITES.reincidenciaMinimo };
}

// ── Atividade ────────────────────────────────────────────────────────────────

// h7Ms: tempo jogado nos últimos 7 dias; h28Ms: nos últimos 28 (inclui os 7)
function esfriando(h7Ms, h28Ms) {
  const mediaAnterior = Math.max(0, h28Ms - h7Ms) / 3;
  if (mediaAnterior < LIMITES.esfriandoMediaMinMs) return { esfriando: false, mediaAnteriorMs: mediaAnterior };
  const queda = 1 - h7Ms / mediaAnterior;
  return { esfriando: queda >= LIMITES.esfriandoQueda, queda, mediaAnteriorMs: mediaAnterior };
}

// ── Risco do associado (score 0–100, só para a liderança olhar) ──────────────

const PESOS_RISCO = Object.freeze({
  advAtiva: 20, restricaoAtiva: 25, reincidencia: 15, pagamentoPendente: 10,
  esfriando: 10, naoRecrutar: 20, semAtividade: 10,
});

function riscoDoAssociado(d) {
  const fatores = [];
  const soma = (peso, texto) => { fatores.push({ peso, texto }); };
  if (d.advAtivas > 0) soma(Math.min(d.advAtivas, 3) * PESOS_RISCO.advAtiva, `${d.advAtivas} advertência(s) ativa(s)`);
  if (d.restricoesAtivas > 0) soma(Math.min(d.restricoesAtivas, 2) * PESOS_RISCO.restricaoAtiva, `${d.restricoesAtivas} restrição(ões) ativa(s) no jogo`);
  if (d.reincidente) soma(PESOS_RISCO.reincidencia, `reincidente (${d.ocorrencias90} ocorrências em ${LIMITES.reincidenciaDias} dias)`);
  if (d.pagamentoPendente) soma(PESOS_RISCO.pagamentoPendente, 'pagamento de ADV pendente');
  if (d.esfriando) soma(PESOS_RISCO.esfriando, 'atividade em queda');
  if (d.naoRecrutar) soma(PESOS_RISCO.naoRecrutar, 'ID na lista não recrutar');
  if (d.semAtividadeDias != null && d.semAtividadeDias >= 14) soma(PESOS_RISCO.semAtividade, `${d.semAtividadeDias} dias sem aparecer no jogo`);
  const score = Math.min(100, fatores.reduce((s, f) => s + f.peso, 0));
  const nivel = score >= 60 ? 'ALTO' : score >= 30 ? 'MÉDIO' : 'BAIXO';
  return { score, nivel, fatores };
}

// ── Contribuição (baú e banco) ───────────────────────────────────────────────

// entrou: quanto pôs; saiu: quanto tirou. Só compara mesma moeda/unidade (quem chama filtra).
function contribuicao(entrou, saiu) {
  const total = entrou + saiu;
  if (total < LIMITES.contribuicaoMinimo) return { papel: 'SEM MOVIMENTO', liquido: entrou - saiu, razao: null };
  const razao = saiu === 0 ? Infinity : entrou / saiu;
  const papel = razao >= 1.5 ? 'CONTRIBUINTE' : razao <= 0.5 ? 'CONSUMIDOR' : 'EQUILIBRADO';
  return { papel, liquido: entrou - saiu, razao };
}

// valores: quantidades por pessoa. Devolve quanto as N maiores respondem do total.
function concentracao(valores, n = LIMITES.concentracaoTop) {
  const positivos = valores.filter(v => v > 0).sort((a, b) => b - a);
  const total = positivos.reduce((s, v) => s + v, 0);
  if (!total) return { total: 0, participacao: 0, pessoas: positivos.length, alerta: false };
  const participacao = positivos.slice(0, n).reduce((s, v) => s + v, 0) / total;
  return {
    total, participacao, pessoas: positivos.length,
    alerta: positivos.length > n && participacao >= LIMITES.concentracaoAlerta,
  };
}

// ── Recrutamento ─────────────────────────────────────────────────────────────

// fichas: [{ criado_em, decidido_em, status, decidido_por_id }]
function slaDasFichas(fichas, agora = new Date()) {
  const decididas = fichas.filter(f => f.decidido_em && f.status !== 'PENDENTE');
  const duracoes = decididas.map(f => new Date(f.decidido_em) - new Date(f.criado_em)).filter(ms => ms >= 0);
  const limite = LIMITES.fichaParadaHoras * HORA_MS;
  const paradas = fichas
    .filter(f => f.status === 'PENDENTE' && agora - new Date(f.criado_em) >= limite)
    .sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));
  return {
    decididas: decididas.length,
    mediaMs: duracoes.length ? duracoes.reduce((s, v) => s + v, 0) / duracoes.length : null,
    medianaMs: duracoes.length ? [...duracoes].sort((a, b) => a - b)[Math.floor(duracoes.length / 2)] : null,
    paradas,
  };
}

// linhas: [{ aprovadorId, aprovados, comProblema }]
function qualidadeDosAprovadores(linhas) {
  return linhas
    .map(l => {
      const taxa = l.aprovados ? l.comProblema / l.aprovados : 0;
      return { ...l, taxa, alerta: l.aprovados >= LIMITES.aprovadorAmostraMinima && taxa >= LIMITES.aprovadorTaxaAlerta };
    })
    .sort((a, b) => b.taxa - a.taxa || b.aprovados - a.aprovados);
}

// recrutados: [{ id, nome, recrutadorId, em }]; idsComFicha: Set de ID do jogo com ficha APROVADA
function recrutouSemFicha(recrutados, idsComFicha) {
  return recrutados.filter(r => r.id && !idsComFicha.has(String(r.id)));
}

// Funil a partir da ficha: cada etapa conta candidatos (pessoas, não eventos). A última compara só
// com os recrutados há 7+ dias ("maduros"): quem entrou ontem ainda não pode ter voltado 7 dias depois.
function funilDeFichas({ fichas, aprovadas, mantoCorreto, recrutadas, maduras7, jogaram7d }) {
  const etapas = [
    ['Fichas enviadas', fichas, null], ['Aprovadas', aprovadas, fichas], ['Manto correto', mantoCorreto, aprovadas],
    ['Recrutadas no jogo', recrutadas, aprovadas], ['Jogando 7+ dias depois (dos recrutados há 7+ dias)', jogaram7d, maduras7],
  ];
  return etapas.map(([rotulo, total, base]) => ({ rotulo, total, deAnterior: base ? total / base : null }));
}

// ── Nome parecido (ID troca a cada season: a identidade é o nome) ────────────

// O jogo põe tag no nome ("Milgrau LHP", "Mkzin RSJ", "Jhow Sccp"): quando todas as palavras do nome
// mais curto aparecem no mais longo, é o mesmo nome com tag. Vale se o curto tem 2+ palavras, ou uma
// palavra de 6+ letras, ou uma de 5+ letras e o que sobrou no longo é só tag (até 4 letras).
// "Lucas" dentro de "Lucas Silva" é coincidência; "Mkzin" dentro de "Mkzin RSJ" não.
function nomeContido(a, b) {
  const [curto, longo] = [a, b].map(n => normalizarNome(n).split(' ').filter(Boolean)).sort((x, y) => x.length - y.length);
  if (!curto?.length || curto.length === longo.length) return false;
  if (!curto.every(t => longo.includes(t))) return false;
  if (curto.length >= 2 || curto[0].length >= 6) return true;
  const sobra = longo.filter(t => !curto.includes(t));
  return curto[0].length >= 5 && sobra.every(t => t.length <= 4);
}

// candidatos: [{ nome, ... }]; devolve os que passam do limiar, do mais parecido ao menos
function nomesParecidos(nome, candidatos, limiar = LIMITES.nomeParecido) {
  const alvo = normalizarNome(nome);
  if (!alvo || alvo.length < 3) return [];
  return candidatos
    .map(c => ({ ...c, score: Math.max(similaridade(alvo, normalizarNome(c.nome)), nomeContido(nome, c.nome) ? 0.88 : 0) }))
    .filter(c => c.score >= limiar)
    .sort((a, b) => b.score - a.score);
}

// ── Liderança ────────────────────────────────────────────────────────────────

// eventos: [{ acao, ator_id_fivem, alvo_id_fivem, ocorrido_em }] de restrição, em qualquer ordem.
// Remoção logo depois da adição pelo mesmo ator; e rajada de promoções/rebaixamentos.
function consistenciaDaLideranca(restricoes, movimentosDeCargo) {
  const porAtor = new Map();
  const ficha = id => {
    if (!porAtor.has(id)) porAtor.set(id, { removeuRapido: 0, promocoesEmRajada: 0, acoes: 0 });
    return porAtor.get(id);
  };

  const ordenados = [...restricoes].sort((a, b) => new Date(a.ocorrido_em) - new Date(b.ocorrido_em));
  const ultimaAdicao = new Map(); // `${tipo}|${alvo}` -> evento
  for (const e of ordenados) {
    if (!e.ator_id_fivem) continue;
    const tipo = String(e.acao).replace(/_(adicionou|removeu)$/, '');
    const chave = `${tipo}|${e.alvo_id_fivem}`;
    ficha(e.ator_id_fivem).acoes++;
    if (String(e.acao).endsWith('_adicionou')) {
      ultimaAdicao.set(chave, e);
    } else if (String(e.acao).endsWith('_removeu')) {
      const adicao = ultimaAdicao.get(chave);
      if (adicao && adicao.ator_id_fivem === e.ator_id_fivem
        && new Date(e.ocorrido_em) - new Date(adicao.ocorrido_em) <= LIMITES.removeuRapidoMs) {
        ficha(e.ator_id_fivem).removeuRapido++;
      }
      ultimaAdicao.delete(chave);
    }
  }

  const movimentos = [...movimentosDeCargo].sort((a, b) => new Date(a.ocorrido_em) - new Date(b.ocorrido_em));
  const janelas = new Map(); // ator -> [ms]
  for (const m of movimentos) {
    if (!m.ator_id_fivem) continue;
    const t = new Date(m.ocorrido_em).getTime();
    const lista = (janelas.get(m.ator_id_fivem) ?? []).filter(x => t - x <= HORA_MS);
    lista.push(t);
    janelas.set(m.ator_id_fivem, lista);
    ficha(m.ator_id_fivem).acoes++;
    if (lista.length === LIMITES.promocoesEmRajada) ficha(m.ator_id_fivem).promocoesEmRajada++;
  }

  return [...porAtor.entries()]
    .map(([id, f]) => ({ id, ...f, alerta: f.removeuRapido > 0 || f.promocoesEmRajada > 0 }))
    .sort((a, b) => Number(b.alerta) - Number(a.alerta) || b.acoes - a.acoes);
}

// ── Saídas: por que e com quanto tempo de casa ───────────────────────────────

const FAIXAS_DE_CASA = [['menos de 7 dias', 7], ['7 a 30 dias', 30], ['30 a 90 dias', 90], ['mais de 90 dias', Infinity]];

// saidas: [{ acao, em, recrutado_em, teve_restricao, teve_adv }]. Tempo de casa só existe quando o
// recrutamento foi visto nos logs; sem ele a saída entra em "sem data de entrada".
function perfilDasSaidas(saidas) {
  const faixas = new Map(FAIXAS_DE_CASA.map(([rotulo]) => [rotulo, 0]));
  faixas.set('sem data de entrada', 0);
  const porTipo = {};
  let comProblema = 0;
  for (const s of saidas) {
    porTipo[s.acao] = (porTipo[s.acao] ?? 0) + 1;
    if (s.teve_restricao || s.teve_adv) comProblema++;
    if (!s.recrutado_em) { faixas.set('sem data de entrada', faixas.get('sem data de entrada') + 1); continue; }
    const dias = (new Date(s.em) - new Date(s.recrutado_em)) / DIA_MS;
    const [rotulo] = FAIXAS_DE_CASA.find(([, limite]) => dias < limite);
    faixas.set(rotulo, faixas.get(rotulo) + 1);
  }
  return { total: saidas.length, porTipo, comProblema, faixas: [...faixas.entries()].filter(([, n]) => n > 0) };
}

// Coortes por mês de recrutamento: linhas do SQL { mes, total, maduros7, ficaram7, maduros30, ficaram30 }
function retencaoDasCoortes(linhas) {
  return linhas.map(l => ({
    mes: l.mes, total: l.total,
    d7: l.maduros7 ? l.ficaram7 / l.maduros7 : null, d30: l.maduros30 ? l.ficaram30 / l.maduros30 : null,
    maduros7: l.maduros7, maduros30: l.maduros30,
  }));
}

// ── Cobertura de recrutamento ────────────────────────────────────────────────

// fichasPorHora / recrutadoresPorHora: [{ hora, media }] (média por dia). Hora com ficha chegando acima
// da média e recrutador entrando abaixo de metade da média: candidato espera sem ninguém para atender.
function buracosDeCobertura(fichasPorHora, recrutadoresPorHora, quantas = 4) {
  const media = lista => (lista.length ? lista.reduce((s, x) => s + x.media, 0) / lista.length : 0);
  const mediaFichas = media(fichasPorHora);
  const mediaRec = media(recrutadoresPorHora);
  const rec = new Map(recrutadoresPorHora.map(r => [r.hora, r.media]));
  return fichasPorHora
    .filter(f => f.media > 0 && f.media >= mediaFichas && (rec.get(f.hora) ?? 0) <= mediaRec * 0.5)
    .sort((a, b) => b.media - a.media || a.hora - b.hora)
    .slice(0, quantas)
    .map(f => ({ hora: f.hora, fichas: f.media, recrutadores: rec.get(f.hora) ?? 0 }));
}

// ── Efetividade da advertência ───────────────────────────────────────────────

// advs: [{ status, registrado_por, criada_em, resolvida_em, prazo_em, saiu30, reincidiu60 }]
function efetividadeDeAdv(advs) {
  const porStatus = {};
  const aplicadores = new Map();
  let pagas = 0;
  let comPrazo = 0;
  let saiu = 0;
  let reincidiu = 0;
  for (const a of advs) {
    porStatus[a.status] = (porStatus[a.status] ?? 0) + 1;
    if (a.prazo_em) { comPrazo++; if (a.status === 'PAGA') pagas++; }
    if (a.saiu30) saiu++;
    if (a.reincidiu60) reincidiu++;
    const quem = a.registrado_por ?? 'automática';
    aplicadores.set(quem, (aplicadores.get(quem) ?? 0) + 1);
  }
  return {
    total: advs.length, porStatus,
    taxaPagaNoPrazo: comPrazo ? pagas / comPrazo : null,
    taxaSaiu30: advs.length ? saiu / advs.length : null,
    taxaReincidiu60: advs.length ? reincidiu / advs.length : null,
    aplicadores: [...aplicadores.entries()].map(([id, total]) => ({ id, total })).sort((a, b) => b.total - a.total),
  };
}

// ── Baú: retirada fora do padrão da própria pessoa ───────────────────────────

// retirada: { quantidade }; historico: { n, mediana } (60 dias anteriores, mesmo item, mesma pessoa).
// Compara a pessoa com ela mesma: quem sempre tira muito não dispara; quem nunca tirou e tira, sim.
function retiradaAtipica(retirada, historico) {
  if (!historico || historico.n < 5 || historico.mediana <= 0) return false;
  return retirada.quantidade >= 20 && retirada.quantidade >= historico.mediana * 4;
}

// ── Farm: cargo × produção ───────────────────────────────────────────────────

// membros: [{ discordId, idFivem }]; producao: Map idFivem → quantidade; donos: Set idFivem com cargo
function farmCargoVsProducao(membros, producao) {
  const donos = new Set(membros.map(m => m.idFivem).filter(Boolean));
  return {
    semProducao: membros.filter(m => m.idFivem && !(producao.get(m.idFivem) > 0)),
    semId: membros.filter(m => !m.idFivem),
    producaoSemCargo: [...producao.entries()].filter(([id, q]) => q > 0 && !donos.has(id)).map(([id, q]) => ({ id, quantidade: q }))
      .sort((a, b) => b.quantidade - a.quantidade),
  };
}

// ── Eventos: presença conferida pelo jogo ────────────────────────────────────

// presentes: [idFivem] marcados presentes; online: Set de idFivem online no horário do evento
function presencaConferida(presentes, online) {
  const conferiveis = presentes.filter(Boolean);
  const noJogo = conferiveis.filter(id => online.has(id)).length;
  return { conferiveis: conferiveis.length, noJogo, taxa: conferiveis.length ? noJogo / conferiveis.length : null };
}

// ── Utilidade dos próprios alertas ───────────────────────────────────────────

// metricas: linhas de casos.metricas(). Mede o que o alerta rende: se quase tudo é ignorado, o limite está
// frouxo (ruído); se há caso velho aberto, falta dono. Só sugere: quem ajusta é quem cuida do bot.
function avaliarUtilidadeDosAlertas(metricas) {
  const achados = [];
  for (const m of metricas) {
    const fechados = m.resolvidos + m.ignorados + m.expirados;
    if (fechados >= 10 && m.ignorados / fechados >= 0.7) {
      achados.push({ tipo: m.tipo, gravidade: 'ruido', texto: `ignorado em ${Math.round((m.ignorados / fechados) * 100)}% dos ${fechados} casos fechados: o limite pode estar frouxo` });
    }
    if (m.velhos > 0) {
      achados.push({ tipo: m.tipo, gravidade: 'fila', texto: `${m.velhos} caso(s) aberto(s) há mais de 7 dias` });
    }
    if (m.total >= 10 && m.expirados / m.total >= 0.5) {
      achados.push({ tipo: m.tipo, gravidade: 'ruido', texto: `${Math.round((m.expirados / m.total) * 100)}% expiraram sem ninguém olhar: ninguém é dono deste alerta` });
    }
  }
  return achados;
}

// ── Segurança do patrimônio ──────────────────────────────────────────────────

// fechaduras: [{ rotulo, aberta, desde }]; online: quantos jogadores agora.
// Só alerta quando alguma está destrancada há mais de N minutos e ninguém está online.
function fechaduraSemVigia(fechaduras, online, agora = new Date()) {
  if (online > 0) return [];
  return fechaduras.filter(f => f.aberta === true && f.desde
    && agora - new Date(f.desde) >= LIMITES.sedeAbertaMinutos * 60 * 1000);
}

// ── Território ───────────────────────────────────────────────────────────────

// conquistas: [{ hora, total }] (conquistas de território por hora do dia); ocupacao: [{ hora, media }]
// O jogo não publica "perdeu território"; o que dá para medir é conquistar em hora de pouca gente:
// território frágil, difícil de defender no mesmo horário.
function horasDeRisco(conquistas, ocupacao, quantas = 3) {
  const mediaGeral = ocupacao.length ? ocupacao.reduce((s, o) => s + o.media, 0) / ocupacao.length : 0;
  const ocup = new Map(ocupacao.map(o => [o.hora, o.media]));
  return conquistas
    .filter(p => p.total > 0 && (ocup.get(p.hora) ?? 0) <= mediaGeral)
    .sort((a, b) => b.total - a.total || a.hora - b.hora)
    .slice(0, quantas)
    .map(p => ({ hora: p.hora, conquistas: p.total, online: ocup.get(p.hora) ?? 0 }));
}

module.exports = {
  HORA_MS, DIA_MS, LIMITES, PESOS_RISCO,
  reincidencia, esfriando, riscoDoAssociado, contribuicao, concentracao,
  slaDasFichas, qualidadeDosAprovadores, recrutouSemFicha, funilDeFichas,
  nomesParecidos, consistenciaDaLideranca, fechaduraSemVigia, horasDeRisco,
  avaliarUtilidadeDosAlertas, perfilDasSaidas, retencaoDasCoortes, buracosDeCobertura, efetividadeDeAdv, retiradaAtipica, farmCargoVsProducao, presencaConferida,
};
