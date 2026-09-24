// Tenant Torcida Instalacao — MODO INSTALAÇÃO.
//
// Neste modo o bot só carrega o /setup. Passos:
//   1. Suba o bot com TENANT=_instalacao e rode /setup diagnostico no servidor.
//   2. Rode /setup mapear (acha o que já existe pelo nome) e /setup criar (cria o que falta).
//   3. Cole os trechos gerados aqui (cargos, canais, categorias), preencha logsJogo e o resto
//      (use tenants/gavioes/tenant.js como referência completa) e REMOVA a linha `instalacao: true`.
//   4. Reinicie: o bot valida tudo na subida e lista o que ainda faltar.
module.exports = {
  slug: '_instalacao',
  instalacao: true,
  guildId: '100000000000000900',

  // Servidor de jogo que publica os logs (adapter em fontes/hoolibras/)
  jogo: { fonte: 'hoolibras' },

  // Quais módulos sobem. Sem entrada vale o padrão de cada módulo (modulos/*.js).
  // modulos: { rifas: false, loja: false },
};
