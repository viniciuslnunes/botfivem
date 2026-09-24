module.exports = {
  id: 'rifas',
  descricao: 'Rifas: criação, venda de números, pagamento, sorteio verificável',
  padrao: true,
  requer: ['departamentos', 'eventos', 'financeiro'],
  comandos: ['rifa'],
  carregar() {
    require('../utils/rifas/interacoes');
    // Tipos de tarefa agendada (expirar compra, encerrar rifa)
    require('../utils/rifas/tarefas');
  },
};
