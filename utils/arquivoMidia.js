const { lerConfig } = require('./botConfig');
const { CHAVE_CANAL_LOGS_GESTAO } = require('./logGestao');

// Link de anexo do Discord expira. Foto de produto, evidência de empréstimo etc.
// são reenviadas para um canal de arquivo do bot, e o que se guarda é a referência
// "canal/mensagem" — a URL é buscada de novo na hora de exibir.
const CHAVE_CANAL_ARQUIVO = 'canal_arquivo_midia';

async function canalDeArquivo(client) {
  for (const chave of [CHAVE_CANAL_ARQUIVO, CHAVE_CANAL_LOGS_GESTAO]) {
    const id = await lerConfig(chave);
    const canal = id ? await client.channels.fetch(id).catch(() => null) : null;
    if (canal?.isTextBased()) return canal;
  }
  return null;
}

async function arquivarAnexo(client, anexo, legenda) {
  if (!anexo?.contentType?.startsWith('image/')) throw new Error('O arquivo precisa ser uma imagem.');
  const canal = await canalDeArquivo(client);
  if (!canal) throw new Error('Canal de arquivo não configurado. Rode /loja setup ou /departamentos setup.');
  const mensagem = await canal.send({
    content: legenda ? String(legenda).slice(0, 1900) : undefined,
    files: [{ attachment: anexo.url, name: anexo.name ?? 'imagem.png' }],
    allowedMentions: { parse: [] },
  });
  return { ref: `${canal.id}/${mensagem.id}`, link: mensagem.url };
}

async function urlDaMidia(client, ref) {
  if (!ref) return null;
  const [canalId, mensagemId] = String(ref).split('/');
  const canal = await client.channels.fetch(canalId).catch(() => null);
  const mensagem = canal ? await canal.messages.fetch(mensagemId).catch(() => null) : null;
  return mensagem?.attachments.first()?.url ?? null;
}

module.exports = { arquivarAnexo, urlDaMidia, CHAVE_CANAL_ARQUIVO };
