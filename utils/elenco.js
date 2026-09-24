const db = require('./db');
const config = require('../config/index.js');
const tema = require('../tema');

const CANAL_ELENCO = config.canais.elenco;
const CONFIG_KEY = 'elenco_message_id';
const CARGO_ELENCO = config.cargos.elenco;

async function getElencoMessageId() {
  const res = await db.query('SELECT value FROM bot_config WHERE key = $1', [CONFIG_KEY]);
  return res.rows.length > 0 ? res.rows[0].value : null;
}

async function setElencoMessageId(id) {
  await db.query(
    'INSERT INTO bot_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
    [CONFIG_KEY, id]
  );
}

function construirEmbed(guild) {
  const membros = guild.members.cache.filter(m => m.roles.cache.has(CARGO_ELENCO));

  let descricao = '';
  let i = 1;
  membros.forEach(m => { descricao += `${i++}. <@${m.id}>\n`; });

  if (!descricao) descricao = '*NENHUM MEMBRO NO ELENCO.*';
  if (descricao.length > 4096) descricao = descricao.substring(0, 4093) + '...';

  return {
    color: tema.cor.primaria,
    title: tema.marca.elenco.titulo,
    description: descricao,
    image: { url: tema.urlAnexo(tema.marca.elenco.logo) },
    footer: { text: `Total: ${membros.size} membros` },
    timestamp: new Date().toISOString(),
  };
}

async function atualizarElenco(client) {
  try {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    await guild.members.fetch({ withPresences: false, force: true }).catch(() => {});

    const embed = construirEmbed(guild);
    const canal = await client.channels.fetch(CANAL_ELENCO);
    if (!canal) return;

    const messageId = await getElencoMessageId();

    if (messageId) {
      try {
        const msg = await canal.messages.fetch(messageId);
        await msg.edit({
          embeds: [embed],
          files: [tema.anexo(tema.marca.elenco.logo)],
          allowedMentions: { users: [] },
        });
        return;
      } catch {
        // mensagem deletada — recriar
      }
    }

    const sent = await canal.send({
      embeds: [embed],
      files: [tema.anexo(tema.marca.elenco.logo)],
      allowedMentions: { users: [] },
    });
    await setElencoMessageId(sent.id);
  } catch (err) {
    console.error('[elenco] Erro ao atualizar:', err);
  }
}

module.exports = { atualizarElenco, CARGO_ELENCO };
