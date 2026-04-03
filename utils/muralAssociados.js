const db = require('./db');
const path = require('path');

const LOGO_PATH = path.join(__dirname, '../img/gavioesdafielfivem_logo.png');
const LOGO_FILE = { attachment: LOGO_PATH, name: 'gavioesdafielfivem_logo.png' };

const CANAL_MURAL = '1489521960533626930';
const CONFIG_KEY = 'mural_associados_message_id';

async function getMuralMessageId() {
  const res = await db.query('SELECT value FROM bot_config WHERE key = $1', [CONFIG_KEY]);
  return res.rows.length > 0 ? res.rows[0].value : null;
}

async function setMuralMessageId(id) {
  await db.query(
    'INSERT INTO bot_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
    [CONFIG_KEY, id]
  );
}

function construirEmbed(rows) {
  const MAX_DESC = 3900;

  let descricao = '';
  for (const s of rows) {
    const num = String(s.numero_socio).padStart(2, '0');
    const linha = `**SÓCIO Nº ${num}** — ${s.nome}\n`;
    if ((descricao + linha).length > MAX_DESC) {
      descricao += '*… e mais*';
      break;
    }
    descricao += linha;
  }

  if (!descricao) descricao = '*Nenhum sócio registrado ainda.*';

  return {
    color: 0x000000,
    title: '📋 MURAL DE ASSOCIADOS — GAVIÕES DA FIEL FIVEM',
    description: descricao,
    thumbnail: { url: 'attachment://gavioesdafielfivem_logo.png' },
    footer: { text: `Total: ${rows.length} sócio${rows.length !== 1 ? 's' : ''}` },
    timestamp: new Date().toISOString()
  };
}

async function atualizarMural(client) {
  const res = await db.query(
    'SELECT numero_socio, nome FROM socios ORDER BY numero_socio ASC'
  );
  const rows = res.rows;
  const embed = construirEmbed(rows);

  const canal = await client.channels.fetch(CANAL_MURAL);
  const messageId = await getMuralMessageId();

  if (messageId) {
    try {
      const msg = await canal.messages.fetch(messageId);
      await msg.edit({ embeds: [embed], files: [LOGO_FILE], allowedMentions: { users: [] } });
      return;
    } catch {
      // Mensagem não existe mais — envia nova abaixo
    }
  }

  const nova = await canal.send({ embeds: [embed], files: [LOGO_FILE], allowedMentions: { users: [] } });
  await setMuralMessageId(nova.id);
}

module.exports = { atualizarMural };
