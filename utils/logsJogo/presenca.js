// Cálculos puros de presença simultânea no jogo (sem Discord nem banco), a
// partir dos eventos de entrada/saída de jogadores no canal logs-painel.

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

module.exports = { totalOnline, listaOnline, idsOnline, serieDeOcupacao, picoDoPeriodo };
