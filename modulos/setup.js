// Onboarding de torcida nova. É o único módulo que sobe em modo instalação
// (tenant.instalacao: true): com o servidor ainda sem cargos e canais mapeados,
// o /setup ajuda a descobrir e criar o que falta.
module.exports = {
  id: 'setup',
  descricao: 'Onboarding: /setup diagnostico, mapear e criar',
  padrao: true,
  obrigatorio: true,
  instalacao: true,
  comandos: ['setup'],
  carregar() {
    require('../utils/setup/comando'); // registra o prefixo "setup" (botão de confirmar)
  },
};
