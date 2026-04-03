const { Events } = require('discord.js');
const { atualizarHierarquia, HIERARQUIA } = require('../utils/hierarquiaEmbed');
const { atualizarQuadroRecrutadores, CARGO_RECRUTADOR } = require('../utils/quadroRecrutadores');

const CARGO_IDS_HIERARQUIA = new Set(HIERARQUIA.map(c => c.id));

module.exports = (client) => {
  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;

    const mudouHierarquia =
      [...newRoles.keys()].some(id => !oldRoles.has(id) && CARGO_IDS_HIERARQUIA.has(id)) ||
      [...oldRoles.keys()].some(id => !newRoles.has(id) && CARGO_IDS_HIERARQUIA.has(id));

    const mudouRecrutador =
      (newRoles.has(CARGO_RECRUTADOR) && !oldRoles.has(CARGO_RECRUTADOR)) ||
      (!newRoles.has(CARGO_RECRUTADOR) && oldRoles.has(CARGO_RECRUTADOR));

    if (mudouHierarquia) await atualizarHierarquia(client);
    if (mudouRecrutador) await atualizarQuadroRecrutadores(client);
  });
};
