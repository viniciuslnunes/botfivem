module.exports = {
  id: 'hierarquia',
  descricao: 'Quadro de hierarquia da torcida, atualizado quando alguém muda de cargo',
  padrao: true,
  exige: { canais: ['hierarquia'] },
  comandos: ['hierarquia'],

  async aoMembroAtualizado(antes, depois, client) {
    const { atualizarHierarquia, HIERARQUIA } = require('../utils/hierarquiaEmbed');
    const idsDaHierarquia = new Set(HIERARQUIA.map(c => c.id));
    const oldRoles = antes.roles.cache;
    const newRoles = depois.roles.cache;

    const mudou =
      [...newRoles.keys()].some(id => !oldRoles.has(id) && idsDaHierarquia.has(id)) ||
      [...oldRoles.keys()].some(id => !newRoles.has(id) && idsDaHierarquia.has(id));
    if (mudou) await atualizarHierarquia(client);
  },
};
