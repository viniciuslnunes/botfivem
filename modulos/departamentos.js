module.exports = {
  id: 'departamentos',
  descricao: 'Áreas da torcida: cargos de membro e gestor, canais por área e quadro de departamentos',
  padrao: true,
  comandos: ['departamentos'],
  carregar() {
    require('../utils/departamentos/interacoes');
  },

  // Quadro em dia com quem entrou/saiu das áreas com o bot desligado
  aoIniciar(client) {
    const { atualizarQuadroDepartamentos } = require('../utils/departamentos/quadro');
    return atualizarQuadroDepartamentos(client)
      .catch(err => console.error('[departamentos] Erro ao atualizar quadro:', err));
  },

  async aoMembroAtualizado(antes, depois, client) {
    const config = require('../config/index.js');
    const { removerTodasAsAreas } = require('../utils/departamentos/gestao');
    const { mapaCargosDepartamento } = require('../utils/departamentos/repositorio');
    const { agendarAtualizacaoQuadro } = require('../utils/departamentos/quadro');

    const oldRoles = antes.roles.cache;
    const newRoles = depois.roles.cache;

    // Perder o cargo SÓCIO (por ADV vencida ou pela diretoria) tira das áreas
    const eraSocio = oldRoles.has(config.cargos.socio);
    const ehSocio = newRoles.has(config.cargos.socio);
    if (eraSocio && !ehSocio) {
      await removerTodasAsAreas(client, depois)
        .catch(err => console.error('[departamentos] Erro ao remover áreas no desligamento:', err));
    }

    const cargosDeArea = await mapaCargosDepartamento().catch(() => new Map());
    const mudouArea =
      [...newRoles.keys()].some(id => !oldRoles.has(id) && cargosDeArea.has(id)) ||
      [...oldRoles.keys()].some(id => !newRoles.has(id) && cargosDeArea.has(id));
    if (mudouArea) agendarAtualizacaoQuadro(client);
  },
};
