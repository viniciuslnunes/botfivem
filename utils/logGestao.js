const { lerConfig } = require('./botConfig');
const tema = require('../tema');

// Toda mutação administrativa deixa rastro: quem, o quê, em quem, quando.
// O canal é criado por /departamentos setup; sem ele, o rastro fica no console.
const CHAVE_CANAL_LOGS_GESTAO = 'canal_logs_gestao';

async function registrarLogGestao(client, { titulo, ator = null, campos = [], cor = tema.cor.primaria }) {
  try {
    const canalId = await lerConfig(CHAVE_CANAL_LOGS_GESTAO);
    const canal = canalId ? await client.channels.fetch(canalId).catch(() => null) : null;
    if (!canal) {
      console.log(`[gestao] ${titulo}`, JSON.stringify({ ator, campos }));
      return;
    }
    await canal.send({
      embeds: [{
        color: cor,
        title: titulo,
        fields: [
          ...campos,
          ...(ator ? [{ name: 'POR', value: `<@${ator}>`, inline: true }] : []),
          { name: 'DATA', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
        ],
      }],
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    console.error('[gestao] Erro ao registrar log:', err);
  }
}

module.exports = { registrarLogGestao, CHAVE_CANAL_LOGS_GESTAO };
