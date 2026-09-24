// Ferramentas de teste da liderança (simulam nick, novato e sócio). Desligado
// por padrão: só faz sentido em quem opera o bot.
module.exports = {
  id: 'testes',
  descricao: 'Comandos de teste: testenick, testenovato e testesocio',
  padrao: false,
  exige: { canais: ['logsLideranca'] },
  comandos: ['testenick', 'testenovato', 'testesocio'],
};
