// Sub-marca opcional da torcida (no Gaviões, o elenco [R.S.J]). Desligado por
// padrão: só sobe em tenant que tem o cargo, o canal e a marca do elenco.
module.exports = {
  id: 'elenco',
  descricao: 'Elenco: sub-marca com cargo próprio, lista e quadro no canal',
  padrao: false,
  exige: { cargos: ['elenco'], canais: ['elenco'], marca: ['elenco.titulo', 'elenco.logo', 'elenco.sigla'] },
  comandos: ['elenco'],

  async aoMembroAtualizado(antes, depois, client) {
    const { atualizarElenco, CARGO_ELENCO } = require('../utils/elenco');
    const mudou =
      (depois.roles.cache.has(CARGO_ELENCO) && !antes.roles.cache.has(CARGO_ELENCO)) ||
      (!depois.roles.cache.has(CARGO_ELENCO) && antes.roles.cache.has(CARGO_ELENCO));
    if (mudou) await atualizarElenco(client);
  },
};
