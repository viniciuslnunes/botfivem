// Cargos próprios (cargos.advRec): vazio = o fluxo responde com aviso de
// "não configurado" em vez de escalar o ADV de sócio.
module.exports = {
  id: 'advertenciaRecrutador',
  descricao: 'Advertência de recrutador: cargos próprios, registrar e remover',
  padrao: true,
  exige: { canais: ['advRecrutadores', 'historicoAdvRec'] },
  carregar() {
    require('../utils/advertenciaRecrutador/interacoes');
  },
};
