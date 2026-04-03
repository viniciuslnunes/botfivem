const { PermissionFlagsBits } = require('discord.js');
const path = require('path');

const CATEGORIA_TICKETS = '1442240177228746772';
const CANAL_LOGS = '1442240418744897637';
const LOGO_PATH = path.join(__dirname, '../img/gavioesdafielfivem_logo.png');

// Gera nome do canal a partir do username
function nomeCanalTicket(user) {
  const base = (user.username || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 20);
  return `ticket-${base}`;
}

// Cria o canal privado do ticket
async function criarCanalTicket(guild, user) {
  const categoria = guild.channels.cache.get(CATEGORIA_TICKETS);
  const canal = await guild.channels.create({
    name: nomeCanalTicket(user),
    parent: CATEGORIA_TICKETS,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
    ],
  });
  return canal;
}

// Gera transcript HTML das mensagens do canal
async function gerarTranscript(canal) {
  const mensagens = [];
  let ultima = null;

  while (true) {
    const opts = { limit: 100 };
    if (ultima) opts.before = ultima;
    const batch = await canal.messages.fetch(opts);
    if (batch.size === 0) break;
    mensagens.push(...batch.values());
    ultima = batch.last().id;
    if (batch.size < 100) break;
  }

  mensagens.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  // Agrupa mensagens consecutivas do mesmo autor (até 5 min de diferença)
  const grupos = [];
  for (const m of mensagens) {
    const ultimo = grupos[grupos.length - 1];
    const mesmAutor = ultimo && ultimo.author === m.author.id;
    const perto = ultimo && (m.createdTimestamp - ultimo.lastTs) < 5 * 60 * 1000;
    if (mesmAutor && perto) {
      ultimo.msgs.push(m);
      ultimo.lastTs = m.createdTimestamp;
    } else {
      grupos.push({ author: m.author.id, authorTag: m.author.username, authorAvatar: m.author.displayAvatarURL({ extension: 'png', size: 64 }), isBot: m.author.bot, msgs: [m], lastTs: m.createdTimestamp });
    }
  }

  function escape(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  }

  function renderEmbed(e) {
    const color = e.color ? `#${e.color.toString(16).padStart(6, '0')}` : '#cc0000';
    const fields = (e.fields || []).map(f =>
      `<div class="ef ${f.inline ? 'inline' : ''}"><div class="ef-name">${escape(f.name)}</div><div class="ef-val">${escape(f.value)}</div></div>`
    ).join('');
    return `<div class="embed" style="border-color:${color}">
      ${e.title ? `<div class="e-title">${escape(e.title)}</div>` : ''}
      ${e.description ? `<div class="e-desc">${escape(e.description)}</div>` : ''}
      ${fields ? `<div class="e-fields">${fields}</div>` : ''}
      ${e.footer ? `<div class="e-footer">${escape(e.footer.text)}</div>` : ''}
    </div>`;
  }

  function renderAttachments(atts) {
    return [...atts.values()].map(a => {
      if (a.contentType && a.contentType.startsWith('image/')) {
        return `<img class="att-img" src="${a.url}" alt="${escape(a.name)}">`;
      }
      return `<a class="att-file" href="${a.url}" target="_blank">📎 ${escape(a.name)}</a>`;
    }).join('');
  }

  const linhas = grupos.map(g => {
    const avatar = `<img class="avatar" src="${g.authorAvatar}" onerror="this.style.display='none'">`;
    const badge = g.isBot ? '<span class="bot-badge">BOT</span>' : '';
    const hora = new Date(g.msgs[0].createdTimestamp).toLocaleString('pt-BR');
    const mensagensHtml = g.msgs.map(m => {
      const txt = m.content ? `<div class="msg-text">${escape(m.content)}</div>` : '';
      const embs = m.embeds.map(renderEmbed).join('');
      const atts = m.attachments.size ? renderAttachments(m.attachments) : '';
      return `${txt}${embs}${atts}`;
    }).join('');

    return `<div class="grupo">
      ${avatar}
      <div class="grupo-body">
        <div class="grupo-header">
          <span class="autor">${escape(g.authorTag)}</span>${badge}
          <span class="ts">${hora}</span>
        </div>
        ${mensagensHtml}
      </div>
    </div>`;
  }).join('\n');

  const total = mensagens.length;
  const inicio = mensagens.length ? new Date(mensagens[0].createdTimestamp).toLocaleString('pt-BR') : '-';
  const fim = mensagens.length ? new Date(mensagens[mensagens.length - 1].createdTimestamp).toLocaleString('pt-BR') : '-';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Transcript — #${canal.name}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #1e1f22; color: #dcddde; font-family: 'Segoe UI', sans-serif; font-size: 15px; }

    /* HEADER */
    .header { background: #111214; border-bottom: 3px solid #cc0000; padding: 20px 32px; display: flex; align-items: center; gap: 20px; }
    .header-icon { font-size: 32px; }
    .header-info h1 { color: #fff; font-size: 22px; margin-bottom: 4px; }
    .header-meta { font-size: 13px; color: #888; display: flex; gap: 20px; flex-wrap: wrap; }
    .header-meta span b { color: #ccc; }

    /* MESSAGES */
    .messages { max-width: 900px; margin: 0 auto; padding: 24px 16px; }
    .grupo { display: flex; gap: 14px; padding: 6px 8px; border-radius: 6px; }
    .grupo:hover { background: #25262a; }
    .avatar { width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; background: #2b2d31; }
    .grupo-body { flex: 1; min-width: 0; }
    .grupo-header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
    .autor { font-weight: 700; color: #fff; font-size: 15px; }
    .bot-badge { background: #5865f2; color: #fff; font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 3px; text-transform: uppercase; }
    .ts { font-size: 12px; color: #72767d; }
    .msg-text { color: #dcddde; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }

    /* EMBEDS */
    .embed { border-left: 4px solid #cc0000; background: #2b2d31; border-radius: 4px; padding: 10px 14px; margin-top: 6px; max-width: 520px; }
    .e-title { font-weight: 700; color: #fff; margin-bottom: 6px; font-size: 15px; }
    .e-desc { color: #dcddde; font-size: 14px; line-height: 1.5; white-space: pre-wrap; }
    .e-fields { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .ef { min-width: 40%; }
    .ef.inline { flex: 1; }
    .ef-name { font-weight: 700; color: #fff; font-size: 13px; margin-bottom: 2px; }
    .ef-val { color: #dcddde; font-size: 14px; }
    .e-footer { font-size: 12px; color: #72767d; margin-top: 8px; border-top: 1px solid #3a3b40; padding-top: 6px; }

    /* ATTACHMENTS */
    .att-img { max-width: 400px; max-height: 300px; border-radius: 6px; margin-top: 6px; display: block; }
    .att-file { display: inline-flex; align-items: center; gap: 6px; background: #2b2d31; color: #00aff4; padding: 6px 12px; border-radius: 4px; margin-top: 6px; text-decoration: none; font-size: 14px; }
    .att-file:hover { text-decoration: underline; }

    /* SEPARATOR */
    .day-sep { text-align: center; color: #72767d; font-size: 12px; margin: 16px 0; display: flex; align-items: center; gap: 10px; }
    .day-sep::before, .day-sep::after { content: ''; flex: 1; height: 1px; background: #3a3b40; }

    /* FOOTER */
    .footer { text-align: center; padding: 20px; font-size: 12px; color: #444; border-top: 1px solid #2b2d31; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-icon">🎫</div>
    <div class="header-info">
      <h1>#${canal.name}</h1>
      <div class="header-meta">
        <span><b>Início:</b> ${inicio}</span>
        <span><b>Fechado:</b> ${fim}</span>
        <span><b>Mensagens:</b> ${total}</span>
        <span><b>Servidor:</b> Gaviões da Fiel — FiveM</span>
      </div>
    </div>
  </div>
  <div class="messages">
    ${linhas || '<p style="color:#72767d;text-align:center;padding:40px">Nenhuma mensagem encontrada.</p>'}
  </div>
  <div class="footer">Transcript gerado automaticamente pelo bot Gaviões da Fiel FiveM</div>
</body>
</html>`;
}

module.exports = { criarCanalTicket, gerarTranscript, CANAL_LOGS, LOGO_PATH };
