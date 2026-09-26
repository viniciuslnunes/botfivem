// Posta embed (com menções no content) num canal do servidor; false se o canal não existe.
async function enviarNoCanal(guild, canalId, embed, content) {
  const canal = await guild.channels.fetch(canalId).catch(() => null);
  if (!canal) return false;
  await canal.send({ ...(content ? { content } : {}), embeds: [embed] });
  return true;
}

module.exports = { enviarNoCanal };
