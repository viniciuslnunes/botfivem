// Tenant de EXEMPLO: uma torcida fictícia de mancha verde. Serve de molde para
// onboarding de torcida nova e de prova de que o bot é reativo (o tema aqui é
// verde; o dos Gaviões proíbe verde). Todos os IDs são falsos e sequenciais.
// Não sobe em produção: TENANT=_exemplo só é usado em testes.
const id = n => String(100000000000000000n + BigInt(n));

const cargos = {
  socio: id(1), provarManto: id(2), reprovadoRecrutamento: id(3), visitante: id(4),
  presidente: id(5), vicePresidente: id(6), velhaGuarda: id(7), diretoria: id(8), recrutador: id(9),
  elenco: null, // esta torcida não tem sub-marca de elenco
  adv: [id(10), id(11), id(12)],
  advRec: [],
};

module.exports = {
  slug: '_exemplo',

  // Esta torcida só usa o essencial: sem rifas, loja, caravana, escala,
  // patrimônio, memória, financeiro, anti-spam, farm nem advertência de recrutador.
  modulos: {
    rifas: false, loja: false, caravana: false, escala: false, patrimonio: false, memoria: false,
    financeiro: false, antiSpam: false, painelFarm: false, painelRecrutadores: false,
    advertenciaRecrutador: false,
    advertenciaRecrutadorAuto: false, meritoRecrutadores: false,
  },
  // Servidor de jogo que publica os logs: qual adapter (fontes/<id>/) traduz o webhook
  jogo: { fonte: 'hoolibras' },

  guildId: id(100),

  canais: {
    recrutamento: id(101), provarManto: id(102), validarSetagem: id(103), validarId: id(104),
    naoRecrutar: id(105), historicoNaoRecrutar: id(106), advertencia: id(107), historicoAdv: id(108),
    advPendentes: id(109), advRecrutadores: id(110), historicoAdvRec: id(111), carteirinha: id(112),
    mural: id(113), ticket: id(114), logsTicket: id(115), hierarquia: id(116), elenco: null,
    quadroRecrutadores: id(117), topRecrutadores: id(118), logsLideranca: null, alertaNovatos: id(119),
    antiSpam: null, associadoEmAtencao: null, ocorrencias: null, setagensPendentes: null, atualizacoes: null, telefoneSocio: id(120),
  },

  categorias: { tickets: id(200) },
  parceiros: [{ label: 'Parceiro Exemplo', url: 'https://example.com' }],
  cargos,
  links: { whatsappSocios: 'https://chat.whatsapp.com/exemplo', redesSociais: 'https://linktr.ee/exemplo' },

  hierarquia: [
    { id: cargos.presidente, label: 'PRESIDENTE' },
    { id: cargos.vicePresidente, label: 'VICE PRESIDENTE' },
    { id: cargos.diretoria, label: 'DIRETORIA' },
  ],
  lideranca: [cargos.presidente, cargos.vicePresidente, cargos.velhaGuarda, cargos.diretoria],

  departamentos: [
    { slug: 'financeiro', nome: 'Financeiro', emoji: '💰', descricao: 'Controla o caixa da torcida.', canalId: null },
    { slug: 'social', nome: 'Social e Eventos', emoji: '🎉', descricao: 'Organiza eventos e festas.', canalId: null },
  ],

  eventos: { lembreteMinutos: 60, publicarDiasAntes: 7, maxSemanasSerie: 12 },
  carteirinha: { vencendoDias: 30, avisoVencimentoDias: 7 },

  logsJogo: {
    canais: [id(301), id(302)],
    categoriaLogs: id(300),
    nomesCanais: { [id(301)]: 'logs-painel', [id(302)]: 'logs-registros' },
    fonteParadaDias: 3,
    canalAlertas: id(119),
    mencionarAlertas: [cargos.presidente, cargos.diretoria],
    canalPainel: null,
    painelIntervaloMin: 30,
    canalPainelJogadores: null,
    painelJogadoresIntervaloMin: 5,
    presencaSessaoMaxHoras: 24,
    presencaReconexaoFolgaMin: 2,
    inatividadeDias: 7,
    novatoSemRecrutamentoDias: 3,
    retencaoRecrutamentoDias: 14,
    bau: { alertaRetiradaQtd: 500 },
    farm: {
      itens: [], // sem farm: o alerta de retirada suspeita fica inerte
      baus: [],
      itensDroga: [],
      limitePadraoDroga: { default: 20 },
    },
    caixa: { alertaSaqueValor: 100000 },
  },

  antiSpam: {
    modo: 'alerta',
    altaCerteza: { janelaSegundos: 60, arquivosMinimos: 2, canaisMinimos: 4 },
    cargosIsentos: [cargos.recrutador],
    janelaSegundos: 30, canaisMesmaMensagem: 3, canaisQualquerMensagem: 5,
    historicoSegundos: 120, apagarNaHoraSegundos: 60, castigoHoras: 24, castigoManualDias: 7,
    amostraImagens: { max: 4, maxBytes: 8 * 1024 * 1024 },
  },

  confianca: { cargosNivel: [] },
  memoria: { anosMax: 5, diasFuturoMax: 90, resumoEventoHoras: 6 },
};
