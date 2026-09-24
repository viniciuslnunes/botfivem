// Advertência automática de recrutador: cruza inteligência de recrutadores (logs do
// jogo), placar do manto e fichas com a escada de advertências. Regras em
// docs/contratos/regras-negocio.md.
module.exports = {
  id: 'advertenciaRecrutadorAuto',
  descricao: 'Advertência automática de recrutador: inatividade, retenção, manto errado e ficha incompleta',
  padrao: true,
  requer: ['advertenciaRecrutador', 'recrutamento', 'logsJogo'],
  exige: { canais: ['historicoAdvRec'] },
  carregar() {
    require('../utils/advertenciaRecrutadorAuto/varredura'); // registra a tarefa de vencimento
    require('../utils/advertenciaRecrutadorAuto/inteligencia').registrar(); // ADV/manto/fichas no painel de recrutadores
  },
  aoIniciar(client) {
    require('../utils/advertenciaRecrutadorAuto/varredura').iniciar(client);
    require('../utils/advertenciaRecrutadorAuto/paineis').iniciarPaineis(client);
  },
  // Cargo ADV de recrutador dado/tirado à mão: a tabela de advertidos acompanha
  aoMembroAtualizado(antes, depois, client) {
    const config = require('../config/index.js');
    const cargos = Array.isArray(config.cargos.advRec) ? config.cargos.advRec : [];
    if (cargos.some(id => id && antes.roles.cache.has(id) !== depois.roles.cache.has(id))) {
      require('../utils/advertenciaRecrutadorAuto/paineis').atualizarAdvertidos(client);
    }
  },
};
