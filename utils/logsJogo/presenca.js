// Cálculos puros de presença simultânea no jogo (sem Discord nem banco), a
// partir dos eventos de entrada/saída de jogadores no canal logs-painel.
//
// O jogo perde saída de vez em quando (queda de conexão, crash, mensagem que
// não chegou) — normal em log de servidor: no banco de produção, mais de 2/3
// dos IDs têm mais entradas do que saídas. Sem tratar isso, um "entrou" órfão
// deixaria o jogador "online" pra sempre (visto na prática: "desde há um
// mês"). Por isso toda sessão tem um limite: sem uma saída em `limiteMs`, ela
// se fecha sozinha.

// Remove do "estado" (último evento de cada ID) quem já passou do limite de
// sessão sem uma saída, no instante dado — usado tanto pra "quem está online
// agora" (instante = agora) quanto pro estado no início de um período
// (instante = início do período).
function estadoSemSessoesExpiradas(estado, limiteMs, instante) {
  const instanteMs = new Date(instante).getTime();
  return estado.filter(e => e.acao !== 'jogador_entrou' || instanteMs - new Date(e.ocorrido_em).getTime() <= limiteMs);
}

// Insere uma saída sintética pra cada sessão que ultrapasse o limite antes de
// `fimPeriodo` sem uma saída real — tanto as que já vêm abertas do baseline
// quanto as que abrem durante o período. `baselineEstado` deve já estar
// filtrado por estadoSemSessoesExpiradas (senão uma sessão morta há muito
// tempo geraria uma saída sintética logo no início — inofensivo, mas
// desnecessário processar).
function comFechamentosAutomaticos(baselineEstado, eventos, limiteMs, fimPeriodo) {
  const fimMs = new Date(fimPeriodo).getTime();
  const abertas = new Map(); // id -> { nome, desde }
  for (const e of baselineEstado) {
    if (e.acao === 'jogador_entrou') abertas.set(e.id, { nome: e.nome, desde: new Date(e.ocorrido_em).getTime() });
  }

  // Fecha (com um evento sintético) quem já devia ter saído antes de `quandoMs`
  const fecharExpiradaAte = (id, quandoMs, saidas) => {
    const sessao = abertas.get(id);
    if (!sessao) return;
    const prazo = sessao.desde + limiteMs;
    if (prazo <= quandoMs) {
      saidas.push({ id, nome: sessao.nome, acao: 'jogador_saiu', ocorrido_em: new Date(prazo).toISOString() });
      abertas.delete(id);
    }
  };

  const eventosAjustados = [];
  for (const ev of eventos) {
    const quandoMs = new Date(ev.ocorrido_em).getTime();
    fecharExpiradaAte(ev.id, quandoMs, eventosAjustados);
    if (ev.acao === 'jogador_entrou') {
      if (!abertas.has(ev.id)) abertas.set(ev.id, { nome: ev.nome, desde: quandoMs });
    } else {
      abertas.delete(ev.id);
    }
    eventosAjustados.push(ev);
  }
  // Quem segue "aberto" no fim do período: fecha sozinho quem já passou do limite
  for (const id of [...abertas.keys()]) fecharExpiradaAte(id, fimMs, eventosAjustados);

  eventosAjustados.sort((a, b) => new Date(a.ocorrido_em) - new Date(b.ocorrido_em));
  return eventosAjustados;
}

function totalOnline(estado) {
  return estado.filter(e => e.acao === 'jogador_entrou').length;
}

// Quem está online agora (ou no instante do "estado" passado), do mais antigo
// para o mais recente
function listaOnline(estado) {
  return estado
    .filter(e => e.acao === 'jogador_entrou')
    .map(e => ({ id: e.id, nome: e.nome, desde: e.ocorrido_em }))
    .sort((a, b) => new Date(a.desde) - new Date(b.desde));
}

// IDs online no início do período (baseline), a partir do último evento de
// cada jogador antes do início
function idsOnline(estado) {
  return estado.filter(e => e.acao === 'jogador_entrou').map(e => e.id);
}

// Reconstrói QUEM está online ao longo do período (um Set de IDs, não um
// contador) e guarda o pico de cada balde de tempo (hora, dia...).
// Importante fazer por ID, e não por um número só: uma saída sem entrada
// correspondente (queda de conexão, histórico começando no meio de uma
// sessão) não pode derrubar a contagem de quem realmente está online — ela
// só é ignorada para aquele ID. E uma segunda entrada sem saída no meio
// (reconexão rápida, log duplicado) não conta o mesmo jogador duas vezes.
function serieDeOcupacao(idsNoInicio, eventos, baldes) {
  const online = new Set(idsNoInicio);
  let idx = 0;
  return baldes.map(balde => {
    let pico = online.size;
    while (idx < eventos.length && new Date(eventos[idx].ocorrido_em).getTime() < balde.fim) {
      const evento = eventos[idx];
      if (evento.acao === 'jogador_entrou') online.add(evento.id);
      else online.delete(evento.id);
      pico = Math.max(pico, online.size);
      idx++;
    }
    return { chave: balde.chave, pico };
  });
}

function picoDoPeriodo(idsNoInicio, serie) {
  return Math.max(idsNoInicio.length, ...serie.map(b => b.pico));
}

// Tempo jogado por jogador dentro do período: pareia cada entrada com a
// próxima saída do mesmo ID. Quem já estava online no início do período
// (baselineEstado) tem a sessão contada a partir do início do período, não de
// quando entrou de verdade — só interessa o tempo DENTRO da janela pedida.
// Quem ainda está online no fim do período tem a sessão fechada em `fimPeriodo`
// (ou "agora", se for o painel ao vivo). Entrada duplicada sem saída no meio
// não reinicia a sessão; saída sem entrada correspondente é ignorada (não há
// sessão pra fechar). Devolve Map<id, { nome, ms }>.
function tempoJogadoPorPeriodo(baselineEstado, eventos, inicioPeriodo, fimPeriodo) {
  const inicioMs = new Date(inicioPeriodo).getTime();
  const fimMs = new Date(fimPeriodo).getTime();
  const abertas = new Map(); // id -> { nome, desde }
  const acumulado = new Map(); // id -> { nome, ms }

  const abrir = (id, nome, quandoMs) => {
    if (abertas.has(id)) return; // já em sessão: reconexão rápida, não reinicia
    abertas.set(id, { nome, desde: Math.max(quandoMs, inicioMs) });
  };
  const fechar = (id, nome, ateMs) => {
    const sessao = abertas.get(id);
    if (!sessao) return; // saída sem entrada correspondente: nada a fechar
    abertas.delete(id);
    const anterior = acumulado.get(id) ?? { nome: sessao.nome, ms: 0 };
    anterior.ms += Math.max(0, ateMs - sessao.desde);
    anterior.nome = nome ?? sessao.nome ?? anterior.nome;
    acumulado.set(id, anterior);
  };

  for (const e of baselineEstado) {
    if (e.acao === 'jogador_entrou') abrir(e.id, e.nome, new Date(e.ocorrido_em).getTime());
  }
  for (const ev of eventos) {
    const quandoMs = new Date(ev.ocorrido_em).getTime();
    if (ev.acao === 'jogador_entrou') abrir(ev.id, ev.nome, quandoMs);
    else fechar(ev.id, ev.nome, quandoMs);
  }
  // Quem segue online no fim do período: conta até lá
  for (const [id, sessao] of abertas) fechar(id, sessao.nome, fimMs);

  return acumulado;
}

module.exports = {
  estadoSemSessoesExpiradas,
  comFechamentosAutomaticos,
  totalOnline,
  listaOnline,
  idsOnline,
  serieDeOcupacao,
  picoDoPeriodo,
  tempoJogadoPorPeriodo,
};
