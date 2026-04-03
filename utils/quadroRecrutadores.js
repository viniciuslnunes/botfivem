const path = require('path');
const db = require('./db');

const LOGO_PATH = path.join(__dirname, '../img/gavioesdafielfivem_logo.png');
const CANAL_QUADRO = '1326966898134482955';
const CONFIG_KEY = 'quadro_recrutadores_message_id';
const CARGO_RECRUTADOR = '1198743169030951010';

async function getQuadroMessageId() {
  const res = await db.query('SELECT value FROM bot_config WHERE key = $1', [CONFIG_KEY]);
  return res.rows.length > 0 ? res.rows[0].value : null;
}

async function setQuadroMessageId(id) {
  await db.query(
    'INSERT INTO bot_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
    [CONFIG_KEY, id]
  );
}

function construirEmbed(guild) {
  const membros = guild.members.cache.filter(m => m.roles.cache.has(CARGO_RECRUTADOR));

  let descricao = '';
  membros.forEach(m => {
    descricao += `<@${m.id}>\n`;
  });

  if (!descricao) descricao = '*NENHUM RECRUTADOR REGISTRADO.*';

  if (descricao.length > 4096) descricao = descricao.substring(0, 4093) + '...';

  return {
    color: 0x000000,
    title: '📋 QUADRO DE RECRUTADORES — GAVIÕES DA FIEL FIVEM',
    description: descricao,
    thumbnail: { url: 'attachment://gavioesdafielfivem_logo.png' },
    footer: { text: `TOTAL: ${membros.size} RECRUTADOR${membros.size !== 1 ? 'ES' : ''}` },
    timestamp: new Date().toISOString(),
  };
}

async function atualizarQuadroRecrutadores(client) {
  try {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    await guild.members.fetch({ withPresences: false, force: true }).catch(() => {});

    const embed = construirEmbed(guild);
    const canal = await client.channels.fetch(CANAL_QUADRO);
    if (!canal) return;

    const messageId = await getQuadroMessageId();

    if (messageId) {
      try {
        const msg = await canal.messages.fetch(messageId);
        await msg.edit({
          embeds: [embed],
          files: [{ attachment: LOGO_PATH, name: 'gavioesdafielfivem_logo.png' }],
          allowedMentions: { users: [] },
        });
        return;
      } catch {
        // mensagem deletada — recriar
      }
    }

    const sent = await canal.send({
      embeds: [embed],
      files: [{ attachment: LOGO_PATH, name: 'gavioesdafielfivem_logo.png' }],
      allowedMentions: { users: [] },
    });
    await setQuadroMessageId(sent.id);
  } catch (err) {
    console.error('[quadroRecrutadores] Erro ao atualizar:', err);
  }
}

module.exports = { atualizarQuadroRecrutadores, CARGO_RECRUTADOR };
