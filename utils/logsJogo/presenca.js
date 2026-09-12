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

// Reconstrói a ocupação simultânea dentro do período: parte da contagem no
// início do período (baseline, calculada fora daqui) e vai somando/subtraindo
// cada entrada/saída, guardando o pico de cada balde de tempo (hora, dia...).
// Saída sem entrada correspondente (log perdido, bot reiniciado) nunca deixa
// o contador ficar negativo.
function serieDeOcupacao(baseline, eventos, baldes) {
  let atual = baseline;
  let idx = 0;
  return baldes.map(balde => {
    let pico = atual;
    while (idx < eventos.length && new Date(eventos[idx].ocorrido_em).getTime() < balde.fim) {
      atual += eventos[idx].acao === 'jogador_entrou' ? 1 : -1;
      if (atual < 0) atual = 0;
      pico = Math.max(pico, atual);
      idx++;
    }
    return { chave: balde.chave, pico };
  });
}

function picoDoPeriodo(baseline, serie) {
  return Math.max(baseline, ...serie.map(b => b.pico));
}

module.exports = { totalOnline, listaOnline, serieDeOcupacao, picoDoPeriodo };
