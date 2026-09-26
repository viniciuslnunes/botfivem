const config = require('../../config/index.js');
const { registrarTipo } = require('../agendador');
const { agendar } = require('../agendador');
const repo = require('./repositorio');
const { canalDeSorteios } = require('./estrutura');
const { LEMBRETE_ENTREGA_MS } = require('./interacoes');

// Prêmio sorteado e não entregue não pode ficar esquecido: até 3 lembretes,
// um por dia, no canal de sorteios, marcando a presidência. Se tudo já foi
// entregue, a tarefa termina em silêncio. Sobrevive a reinício (agendador).
const MAX_LEMBRETES = 3;

async function lembrarEntrega(client, p) {
  const sorteio = await repo.buscar(p.sorteioId);
  if (!sorteio || sorteio.status !== 'CONCLUIDO') return;
  const pendentes = (await repo.premios(sorteio.id)).filter(x => x.numero != null && !x.entregue_em);
  if (!pendentes.length) return;
  const canal = await canalDeSorteios(client);
  if (canal) {
    await canal.send({
      content: `📦 <@&${config.cargos.presidente}> o sorteio **#${sorteio.id} — ${sorteio.titulo}** ainda tem **${pendentes.length}** prêmio(s) por entregar. Marque a entrega no histórico.`,
      allowedMentions: { roles: [config.cargos.presidente] },
    });
  }
  await repo.contarLembrete(sorteio.id);
  if (sorteio.lembretes_entrega + 1 < MAX_LEMBRETES) {
    await agendar('sorteio_lembrar_entrega', new Date(Date.now() + LEMBRETE_ENTREGA_MS), { sorteioId: sorteio.id });
  }
}

registrarTipo('sorteio_lembrar_entrega', lembrarEntrega);

module.exports = { lembrarEntrega };
