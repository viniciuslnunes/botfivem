// Mérito de recrutadores: ciclos de 8 semanas, ranking por constância e qualidade,
// indicação dos 3 melhores e votação da liderança. O bot indica; a promoção é humana.
// Regras em docs/contratos/regras-negocio.md (seção Mérito de recrutadores).
module.exports = {
  id: 'meritoRecrutadores',
  descricao: 'Mérito de recrutadores: ranking por constância e qualidade, indicação ao departamento e votação da liderança',
  padrao: true,
  requer: ['recrutamento', 'logsJogo', 'advertenciaRecrutadorAuto'],
  comandos: ['merito'],
  carregar() {
    require('../utils/merito/servico'); // registra as tarefas de fechamento e de votação
    require('../utils/merito/interacoes');
    // O quadro 📘・regras-recrutadores ganha a seção de mérito (só com este módulo ligado)
    require('../utils/advertenciaRecrutadorAuto/paineis')
      .registrarSecaoRegras(() => require('../utils/merito/extrato').embedRegrasMerito());
  },
  aoIniciar(client) {
    require('../utils/merito/paineis').iniciarPaineis(client);
    require('../utils/merito/servico').iniciar(client);
  },
};
