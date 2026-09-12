const { lerConfig, gravarConfig } = require('./botConfig');

// Publica uma mensagem uma única vez por canal (id guardado em bot_config).
// Rodar de novo não duplica; se a mensagem for apagada, é recriada.
async function garantirMensagemFixa(canal, chave, montarConteudo) {
  const mensagemId = await lerConfig(chave);
  if (mensagemId) {
    const existente = await canal.messages.fetch(mensagemId).catch(() => null);
    if (existente) return { mensagem: existente, criada: false };
  }
  const nova = await canal.send(montarConteudo());
  await gravarConfig(chave, nova.id);
  return { mensagem: nova, criada: true };
}

module.exports = { garantirMensagemFixa };
