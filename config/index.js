// Centralize IDs e constantes do servidor aqui — nenhum arquivo deve ter ID solto.
const cargos = {
  socio: '1330990668654444604',
  provarManto: '1487347860734218250',
  reprovadoRecrutamento: '1487555867225231401',
  visitante: '1353126088649347174',
  presidente: '1198743169081295021',
  vicePresidente: '1198743169081295020',
  velhaGuarda: '1380046518157054013',
  diretoria: '1198743169081295019',
  recrutador: '1198743169030951010',
  elenco: '1489461786511020285', // [R.S.J] RUA SÃO JORGE
  // Advertência de sócio: [ADV¹, ADV², ADV³]
  adv: ['1341153479602864188', '1341149153992114229', '1340321522547429458'],
  // Advertência de recrutador: cargos PRÓPRIOS, nunca os ADV¹/²/³ de sócio.
  // Ordem: [ADV¹ REC, ADV² REC, ADV³ REC]. Vazio = fluxo bloqueado com aviso.
  advRec: [],
};

module.exports = {
  guildId: '1198743169030951004',

  canais: {
    recrutamento: '1442244198760976434',
    provarManto: '1461524452608053405',
    validarSetagem: '1442240838699712623',
    validarId: '1487943479710580756',
    naoRecrutar: '1487943419203551313',
    historicoNaoRecrutar: '1487943943680163890',
    advertencia: '1488653988168601710',
    historicoAdv: '1488654031709671574',
    advPendentes: '1489558741996146771',
    advRecrutadores: '1489851602381836538',
    historicoAdvRec: '1447408212293714080',
    carteirinha: '1489527029568245891',
    mural: '1489521960533626930',
    ticket: '1442247874808385797',
    logsTicket: '1442240418744897637',
    hierarquia: '1198743170972926110',
    elenco: '1489462740149080125',
    quadroRecrutadores: '1326966898134482955',
    topRecrutadores: '1444861031598784673',
    logsLideranca: '1461544673825783929',
    alertaNovatos: '1490536504748150925',
  },

  categorias: {
    tickets: '1442240177228746772',
  },

  cargos,

  // Exibida no embed de hierarquia, nesta ordem
  hierarquia: [
    { id: cargos.presidente, label: 'GDF • PRESIDENTE' },
    { id: cargos.vicePresidente, label: 'GDF • VICE PRESIDENTE' },
    { id: cargos.velhaGuarda, label: 'GDF • VELHA GUARDA' },
    { id: cargos.diretoria, label: 'GDF • DIRETORIA' },
    { id: cargos.recrutador, label: 'EQUIPE RECRUTAMENTO 🦅' },
  ],

  // Quem consulta logs, estatísticas e situação das carteirinhas
  lideranca: [cargos.presidente, cargos.vicePresidente, cargos.velhaGuarda, cargos.diretoria],

  // Áreas da torcida. Cargos (MEMBRO • / GESTOR •) e canais são criados por
  // /departamentos setup e guardados no banco. A Diretoria não entra aqui: já
  // existe como cargo GDF • DIRETORIA e aparece no embed de hierarquia.
  departamentos: [
    { slug: 'financeiro', nome: 'Financeiro', emoji: '💰' },
    { slug: 'social', nome: 'Social e Eventos', emoji: '🎉' },
    { slug: 'loja', nome: 'Materiais e Loja', emoji: '🛍️' },
    { slug: 'comunicacao', nome: 'Comunicação', emoji: '📣' },
    { slug: 'patrimonio', nome: 'Patrimônio', emoji: '🗃️' },
    { slug: 'bandeiras', nome: 'Bandeiras', emoji: '🚩' },
    { slug: 'bateria', nome: 'Bateria', emoji: '🥁' },
    { slug: 'caravanas', nome: 'Caravanas', emoji: '🚌' },
    { slug: 'feminino', nome: 'Feminino', emoji: '🌹' },
    { slug: 'carnaval', nome: 'Carnaval', emoji: '🎭' },
  ],

  eventos: {
    lembreteMinutos: 60, // DM aos confirmados antes de começar
    publicarDiasAntes: 7, // ocorrências de uma série só aparecem no canal perto da data
    maxSemanasSerie: 12,
  },

  carteirinha: {
    vencendoDias: 30, // a partir daqui a carteirinha aparece como "vencendo"
    avisoVencimentoDias: 7, // DM ao sócio quando faltar isso para vencer
  },

  // Logs que o FiveM publica por webhook. Os canais continuam como estão;
  // o bot só lê, grava para filtros/estatísticas e dispara alertas.
  logsJogo: {
    canais: ['1461544673825783929'], // logs-liderança
    canalAlertas: '1490536504748150925',
    mencionarAlertas: [cargos.presidente, cargos.vicePresidente, cargos.velhaGuarda, cargos.diretoria, cargos.recrutador],
    // Canal do painel fixo de estatísticas. null = painel desligado.
    canalPainel: null,
    painelIntervaloMin: 30,
    inatividadeDias: 7,
    novatoSemRecrutamentoDias: 3, // alerta quem entrou no jogo e não pediu recrutamento após N dias
  },

  confianca: {
    // Cargo cosmético por nível [Novato, Conhecido, De casa, Referência]. Vazio = sem cargo.
    cargosNivel: [],
  },

  memoria: {
    anosMax: 5, // quanto a memória volta no tempo
    diasFuturoMax: 90,
    resumoEventoHoras: 6, // resumo do evento entra na memória N horas depois do início
  },
};
