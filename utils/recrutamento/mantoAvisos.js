const config = require('../../config/index.js');
const tema = require('../../tema');
const fichas = require('./fichas');
const repo = require('./mantoRepositorio');
const { avisoAoAprovar, rotuloMotivo } = require('./mantoRegras');
const { JANELA_DESFAZER_MS } = require('./regras');

// Aprovou a ficha com o manto errado, sem avaliação ou sem foto? O recrutador é
// avisado na própria ficha, com o prazo de desfazer. Só informa: não trava a
// aprovação (a decisão é dele) e o erro só conta se a situação continuar assim.
// Assinado pelo módulo recrutamento no evento `ficha.decidida` (barramento).
async function aoFichaDecidida({ client, fichaId, status, decididaPorId, discordId }) {
  if (status !== 'APROVADO') return;
  const ficha = await fichas.buscarFicha(fichaId);
  const aviso = avisoAoAprovar(await repo.fotosDoCandidato(discordId, ficha?.criado_em ?? null), rotuloMotivo);
  if (!aviso) return;

  const canal = await client.channels.fetch(config.canais.validarSetagem).catch(() => null);
  const mensagem = await canal?.messages.fetch(fichaId).catch(() => null);
  if (!mensagem) return;
  const minutos = Math.round(JANELA_DESFAZER_MS / 60000);
  await mensagem.reply({
    content: `${tema.emoji.aviso} <@${decididaPorId}>, você aprovou <@${discordId}>, mas ${aviso.texto}\n`
      + `Se foi engano, use **DESFAZER DECISÃO** em até ${minutos} min.`,
    allowedMentions: { users: [decididaPorId] },
  });
}

module.exports = { aoFichaDecidida };
