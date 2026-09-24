const db = require('./db');
const config = require('../config/index.js');
const tema = require('../tema');

const CANAL_HIERARQUIA = config.canais.hierarquia;
const CONFIG_KEY = 'hierarquia_message_id';

const HIERARQUIA = config.hierarquia;

async function getHierarquiaMessageId() {
  const res = await db.query('SELECT value FROM bot_config WHERE key = $1', [CONFIG_KEY]);
  return res.rows.length > 0 ? res.rows[0].value : null;
}

async function setHierarquiaMessageId(id) {
  await db.query(
    'INSERT INTO bot_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
    [CONFIG_KEY, id]
  );
}

function construirEmbed(guild) {
  const fields = [];

  for (const cargo of HIERARQUIA) {
    const membros = guild.members.cache.filter(m => m.roles.cache.has(cargo.id));
    if (!membros.size) continue;

    let lista = '';
    membros.forEach(m => { lista += `<@${m.id}>\n`; });
    if (lista.length > 1024) lista = lista.substring(0, 1021) + '...';

    fields.push({
      name: `${cargo.label} (${membros.size})`,
      value: lista.trim(),
      inline: false,
    });
  }

  return {
    color: tema.cor.primaria,
    title: tema.titulo('🦅 HIERARQUIA'),
    fields: fields.length ? fields : [{ name: 'SEM MEMBROS', value: 'Nenhum membro encontrado.', inline: false }],
    thumbnail: { url: tema.urlLogo() },
    footer: { text: 'Atualizado automaticamente' },
    timestamp: new Date().toISOString(),
  };
}

async function atualizarHierarquia(client) {
  try {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    // Garantir que o cache de membros está atualizado
    await guild.members.fetch({ withPresences: false, force: true }).catch(() => {});

    const embed = construirEmbed(guild);
    const canal = await client.channels.fetch(CANAL_HIERARQUIA);
    if (!canal) return;

    const messageId = await getHierarquiaMessageId();

    if (messageId) {
      try {
        const msg = await canal.messages.fetch(messageId);
        await msg.edit({
          embeds: [embed],
          files: [tema.logo()],
          allowedMentions: { users: [] },
        });
        return;
      } catch {
        // mensagem deletada — recriar
      }
    }

    const sent = await canal.send({
      embeds: [embed],
      files: [tema.logo()],
      allowedMentions: { users: [] },
    });
    await setHierarquiaMessageId(sent.id);
  } catch (err) {
    console.error('[hierarquia] Erro ao atualizar:', err);
  }
}

module.exports = { atualizarHierarquia, HIERARQUIA };
