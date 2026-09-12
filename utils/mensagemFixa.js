const { lerConfig, gravarConfig } = require('./botConfig');

// Mantém uma mensagem só por canal (id guardado em bot_config): cria na primeira
// vez e, depois, sempre edita para o conteúdo atual — assim um botão novo (ou um
// texto corrigido) chega em quem já tinha a mensagem, sem duplicar nada. Se a
// mensagem for apagada, é recriada.
async function garantirMensagemFixa(canal, chave, montarConteudo) {
  const conteudo = montarConteudo();
  const mensagemId = await lerConfig(chave);
  if (mensagemId) {
    const existente = await canal.messages.fetch(mensagemId).catch(() => null);
    if (existente) {
      await existente.edit(conteudo);
      return { mensagem: existente, criada: false };
    }
  }
  const nova = await canal.send(conteudo);
  await gravarConfig(chave, nova.id);
  return { mensagem: nova, criada: true };
}

module.exports = { garantirMensagemFixa };
