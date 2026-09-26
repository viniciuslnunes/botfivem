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

  // Cria o canal de pagamentos na subida, se ainda não existe (cargos e posição ficam com a liderança)
  async aoIniciar(client) {
    try {
      const config = require('../config/index.js');
      const guild = await client.guilds.fetch(config.guildId);
      await guild.members.fetchMe();
      const resumo = await require('../utils/rifas/estrutura').montarEstruturaRifas(guild);
      console.log(`[rifas] ${resumo.join(' | ')}`);
    } catch (err) {
      console.error('[rifas] Erro ao montar a estrutura:', err);
    }
  },
};
