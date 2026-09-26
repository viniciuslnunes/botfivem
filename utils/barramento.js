// Barramento de eventos entre fluxos: um fluxo anuncia o que aconteceu ("ficha decidida",
// "advertência registrada", "ticket aberto") e outros módulos reagem sem que o primeiro os conheça.
// Módulo desligado nunca assina, então não deixa rastro. Erro num assinante é logado e não derruba
// o fluxo de origem nem os outros assinantes. Quem emite NÃO espera o resultado por padrão
// (o fluxo de origem não pode atrasar por causa de quem ouve).
const assinantes = new Map(); // evento -> [fn]

function assinar(evento, fn) {
  const lista = assinantes.get(evento) ?? [];
  if (!lista.includes(fn)) lista.push(fn);
  assinantes.set(evento, lista);
}

async function emitirEAguardar(evento, payload) {
  for (const fn of assinantes.get(evento) ?? []) {
    try {
      await fn(payload);
    } catch (err) {
      console.error(`[barramento] Assinante de "${evento}" falhou:`, err);
    }
  }
}

// Dispara e segue: devolve a promessa só para teste esperar
function emitir(evento, payload) {
  return emitirEAguardar(evento, payload);
}

// Quem emite pode ter um plano B quando ninguém escuta (módulo que reage está desligado)
function temAssinante(evento) {
  return (assinantes.get(evento) ?? []).length > 0;
}

// Só para teste: esquece todos os assinantes de um evento
function limpar(evento) {
  assinantes.delete(evento);
}

module.exports = { assinar, emitir, limpar, temAssinante };
