module.exports = {
  id: 'atualizacoes',
  descricao: 'Canal de atualizações: novidades e mudanças de regra postadas sozinhas, só as dos módulos ligados (`canais.atualizacoes`, null = sem canal)',
  padrao: true,

  // Sobe depois dos outros módulos e nunca atrasa nem derruba a partida (o erro cai no log do módulo)
  aoIniciar(client, ctx) {
    return require('../utils/atualizacoes/publicador').publicarPendentes(client, { moduloAtivo: ctx.moduloAtivo });
  },
};
