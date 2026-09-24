const db = require('./db');
const config = require('../config/index.js');
const tema = require('../tema');
const E = require('./logsJogo/estatisticas');
const repoLogs = require('./logsJogo/repositorio');

const CANAL_QUADRO = config.canais.quadroRecrutadores;
const CONFIG_KEY = 'quadro_recrutadores_message_id';
const CARGO_RECRUTADOR = config.cargos.recrutador;

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

async function registrarEntradaNoCargo(discordId) {
  await db.query(
    'INSERT INTO recrutadores_cargo (discord_id) VALUES ($1) ON CONFLICT (discord_id) DO NOTHING',
    [discordId]
  );
}

async function removerEntradaNoCargo(discordId) {
  await db.query('DELETE FROM recrutadores_cargo WHERE discord_id = $1', [discordId]);
}

// Data por Discord ID. A fonte é a promoção a Recrutador logada pelo jogo
// (ID do jogo no apelido); quem não tem ID no apelido ou promoção nos logs
// cai no registro do momento em que o cargo do Discord foi dado.
async function carregarDesde(membros) {
  const desde = new Map();
  try {
    const res = await db.query('SELECT discord_id, desde FROM recrutadores_cargo');
    for (const r of res.rows) desde.set(r.discord_id, new Date(r.desde));
  } catch (err) {
    console.error('[quadroRecrutadores] Erro ao ler datas do cargo:', err.message);
  }
  try {
    const idsFivem = new Map(membros.map(m => [m.id, E.idFivemDoNick(m.nickname ?? m.displayName)]));
    const promocoes = await repoLogs.ultimaPromocaoParaRecrutador([...new Set([...idsFivem.values()].filter(Boolean))]);
    const porIdFivem = new Map(promocoes.map(p => [p.id, new Date(p.desde)]));
    for (const [discordId, idFivem] of idsFivem) {
      if (idFivem && porIdFivem.has(idFivem)) desde.set(discordId, porIdFivem.get(idFivem));
    }
  } catch (err) {
    console.error('[quadroRecrutadores] Erro ao ler promoções do jogo:', err.message);
  }
  return desde;
}

// Só há data para quem ganhou o cargo depois que o registro existe.
function linhaDoRecrutador(id, desde) {
  if (!desde) return `<@${id}>`;
  const ts = Math.floor(desde.getTime() / 1000);
  return `<@${id}> · no DP desde <t:${ts}:d> (<t:${ts}:R>)`;
}

function construirEmbed(guild, desdePorId = new Map()) {
  const membros = guild.members.cache.filter(m => m.roles.cache.has(CARGO_RECRUTADOR));

  let descricao = '';
  membros.forEach(m => {
    descricao += `${linhaDoRecrutador(m.id, desdePorId.get(m.id))}\n`;
  });

  if (!descricao) descricao = '*NENHUM RECRUTADOR REGISTRADO.*';

  if (descricao.length > 4096) descricao = descricao.substring(0, 4093) + '...';

  return {
    color: tema.cor.primaria,
    title: tema.titulo('📋 QUADRO DE RECRUTADORES'),
    description: descricao,
    thumbnail: { url: tema.urlLogo() },
    footer: { text: `TOTAL: ${membros.size} RECRUTADOR${membros.size !== 1 ? 'ES' : ''}` },
    timestamp: new Date().toISOString(),
  };
}

async function atualizarQuadroRecrutadores(client) {
  try {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    await guild.members.fetch({ withPresences: false, force: true }).catch(() => {});

    const recrutadores = [...guild.members.cache.filter(m => m.roles.cache.has(CARGO_RECRUTADOR)).values()];
    const embed = construirEmbed(guild, await carregarDesde(recrutadores));
    const canal = await client.channels.fetch(CANAL_QUADRO);
    if (!canal) return;

    const messageId = await getQuadroMessageId();

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
    await setQuadroMessageId(sent.id);
  } catch (err) {
    console.error('[quadroRecrutadores] Erro ao atualizar:', err);
  }
}

module.exports = {
  atualizarQuadroRecrutadores, registrarEntradaNoCargo, removerEntradaNoCargo, CARGO_RECRUTADOR,
};
