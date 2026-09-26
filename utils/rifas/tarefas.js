const tema = require('../../tema');
const { registrarTipo } = require('../agendador');
const { registrarLogGestao } = require('../logGestao');
const { formatarDinheiro } = require('../logsJogo/estatisticas');
const repo = require('./repositorio');
const { atualizarMensagemRifa } = require('./mensagem');

// Prazos da rifa que precisam sobreviver a reinício

// Reserva sem aviso de pagamento no prazo: os números voltam para a venda.
// Se alguém já retomou os números antes, a compra já está EXPIRADA e nada acontece.
registrarTipo('rifa_expirar_compra', async (client, p) => {
  const compra = await repo.expirarCompra(p.compraId);
  if (compra) await atualizarMensagemRifa(client, compra.rifa_id);
});

registrarTipo('rifa_encerrar', async (client, p) => {
  const rifa = await repo.encerrarRifa(p.rifaId, { automatico: true });
  if (!rifa) return;
  await atualizarMensagemRifa(client, rifa.id);
  const pendentes = await repo.comprasPendentes(rifa.id);
  await registrarLogGestao(client, {
    titulo: `${tema.emoji.alerta} RIFA #${rifa.id} ENCERRADA NO PRAZO — ${rifa.titulo.toUpperCase()}`,
    campos: [
      { name: 'VENDIDOS', value: `${rifa.vendidos}/${rifa.total_numeros}`, inline: true },
      { name: 'ARRECADADO', value: formatarDinheiro(rifa.arrecadado), inline: true },
      { name: 'PAGAMENTOS A CONFERIR', value: String(pendentes.length), inline: true },
    ],
  });
});
