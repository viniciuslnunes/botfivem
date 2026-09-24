module.exports = {
  id: 'nucleo',
  descricao: 'Estrutura básica: diagnóstico de permissões, status de saúde, tarefas agendadas e mensagens fixas de configuração',
  padrao: true,
  obrigatorio: true,
  comandos: ['botperms', 'setup-botoes', 'status'],
  carregar() {
    // Tipos de tarefa agendada (vencimento de ADV, remoção de cargo…): precisam
    // existir mesmo que o módulo dono tenha sido desligado depois de agendar algo.
    require('../utils/tarefas');
  },
};
