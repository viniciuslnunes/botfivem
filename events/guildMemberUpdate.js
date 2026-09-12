const { Events } = require('discord.js');
const config = require('../config/index.js');
const { atualizarHierarquia, HIERARQUIA } = require('../utils/hierarquiaEmbed');
const { atualizarQuadroRecrutadores, CARGO_RECRUTADOR } = require('../utils/quadroRecrutadores');
const { atualizarElenco, CARGO_ELENCO } = require('../utils/elenco');
const { sincronizarCarteirinhaComCargo } = require('../utils/carteirinhaSocio');
const { removerTodasAsAreas } = require('../utils/departamentos/gestao');
const { mapaCargosDepartamento } = require('../utils/departamentos/repositorio');
const { agendarAtualizacaoQuadro } = require('../utils/departamentos/quadro');

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

    const mudouElenco =
      (newRoles.has(CARGO_ELENCO) && !oldRoles.has(CARGO_ELENCO)) ||
      (!newRoles.has(CARGO_ELENCO) && oldRoles.has(CARGO_ELENCO));

    // Desligar (perder o cargo SÓCIO, por ADV vencida ou pela diretoria) revoga a
    // carteirinha, tira do mural e das áreas; recuperar restaura a carteirinha com o mesmo número
    const mudouSocio = oldRoles.has(config.cargos.socio) !== newRoles.has(config.cargos.socio);

    if (mudouHierarquia) await atualizarHierarquia(client);
    if (mudouRecrutador) await atualizarQuadroRecrutadores(client);
    if (mudouElenco) await atualizarElenco(client);
    if (mudouSocio) {
      const ehSocio = newRoles.has(config.cargos.socio);
      await sincronizarCarteirinhaComCargo(client, newMember.id, ehSocio)
        .catch(err => console.error('[carteirinha] Erro ao sincronizar com o cargo:', err));
      if (!ehSocio) {
        await removerTodasAsAreas(client, newMember)
          .catch(err => console.error('[departamentos] Erro ao remover áreas no desligamento:', err));
      }
    }

    const cargosDeArea = await mapaCargosDepartamento().catch(() => new Map());
    const mudouArea =
      [...newRoles.keys()].some(id => !oldRoles.has(id) && cargosDeArea.has(id)) ||
      [...oldRoles.keys()].some(id => !newRoles.has(id) && cargosDeArea.has(id));
    if (mudouArea) agendarAtualizacaoQuadro(client);
  });
};
