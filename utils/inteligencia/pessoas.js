// Sócios do Discord ligados ao ID do jogo (pelo apelido). Base de todo cruzamento por pessoa.
const config = require('../../config/index.js');
const { garantirMembrosCarregados } = require('../membrosGuild');
const E = require('../logsJogo/estatisticas');

async function carregarSocios(client) {
  const guild = await client.guilds.fetch(config.guildId);
  await garantirMembrosCarregados(guild);
  const socios = [...guild.members.cache.values()]
    .filter(m => !m.user?.bot && m.roles.cache.has(config.cargos.socio))
    .map(membro => ({
      membro,
      discordId: membro.id,
      nome: membro.displayName,
      idFivem: E.idFivemDoNick(membro.nickname ?? membro.displayName),
    }));
  return { guild, socios, porIdFivem: new Map(socios.filter(s => s.idFivem).map(s => [s.idFivem, s])) };
}

// Recrutadores (cargo) com o jogo aberto agora: quem está por perto para atender uma ficha
async function recrutadoresOnline(client, agora = new Date()) {
  const logs = require('../logsJogo/repositorio');
  const P = require('../logsJogo/presenca');
  const { guild } = await carregarSocios(client);
  const recrutadores = [...guild.members.cache.values()]
    .filter(m => m.roles.cache.has(config.cargos.recrutador))
    .map(membro => ({ membro, discordId: membro.id, idFivem: E.idFivemDoNick(membro.nickname ?? membro.displayName) }))
    .filter(r => r.idFivem);
  if (!recrutadores.length) return [];
  const limite = config.logsJogo.presencaSessaoMaxHoras * 60 * 60 * 1000;
  const online = new Set(P.listaOnline(P.estadoSemSessoesExpiradas(await logs.estadoDosJogadores(agora), limite, agora)).map(e => e.id));
  return recrutadores.filter(r => online.has(r.idFivem));
}

module.exports = { carregarSocios, recrutadoresOnline };
