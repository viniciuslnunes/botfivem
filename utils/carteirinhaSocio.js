const db = require('./db');
const config = require('../config/index.js');
const { atualizarMural } = require('./muralAssociados');
const { garantirMembrosCarregados } = require('./membrosGuild');

// Carteirinha acompanha o cargo SÓCIO: perdeu o cargo, a carteirinha é revogada
// (sai do mural); voltou, é restaurada com o mesmo número. Nada é apagado.

async function sincronizarCarteirinhaComCargo(client, discordId, ehSocio) {
  const res = ehSocio
    ? await db.query('UPDATE socios SET revogada_em = NULL WHERE discord_id = $1 AND revogada_em IS NOT NULL', [discordId])
    : await db.query('UPDATE socios SET revogada_em = now() WHERE discord_id = $1 AND revogada_em IS NULL', [discordId]);
  if (res.rowCount > 0) await atualizarMural(client);
}

// Acerta o que mudou com o bot desligado. Se a leitura dos membros vier
// incompleta, revogaria meio mural por engano — daí a trava de proporção.
async function reconciliarCarteirinhas(client) {
  const guild = await client.guilds.fetch(config.guildId);
  await garantirMembrosCarregados(guild);
  if (guild.members.cache.size === 0) return 0;

  const { rows } = await db.query('SELECT discord_id, revogada_em FROM socios');
  const mudancas = rows
    .map(row => ({
      discordId: row.discord_id,
      ehSocio: Boolean(guild.members.cache.get(row.discord_id)?.roles.cache.has(config.cargos.socio)),
      revogada: row.revogada_em != null,
    }))
    .filter(m => m.ehSocio === m.revogada);

  const revogacoes = mudancas.filter(m => !m.ehSocio).length;
  if (rows.length > 10 && revogacoes > rows.length / 2) {
    console.warn(`[carteirinha] Reconciliação abortada: revogaria ${revogacoes} de ${rows.length} carteirinhas.`);
    return 0;
  }

  for (const m of mudancas) {
    await db.query(
      m.ehSocio
        ? 'UPDATE socios SET revogada_em = NULL WHERE discord_id = $1'
        : 'UPDATE socios SET revogada_em = now() WHERE discord_id = $1',
      [m.discordId]
    );
  }
  if (mudancas.length > 0) await atualizarMural(client);
  return mudancas.length;
}

module.exports = { sincronizarCarteirinhaComCargo, reconciliarCarteirinhas };
