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
    antiSpam: '1548665394380673108', // 🛡️・anti-spam: alerta de conta hackeada com botões BANIR/LIBERAR. null = alerta só no console
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

  // Áreas da torcida. Cargos (MEMBRO • / GESTOR •) são criados por
  // /departamentos setup e guardados no banco. A Diretoria não entra aqui: já
  // existe como cargo GDF • DIRETORIA e aparece no embed de hierarquia.
  //
  // canalId: cole aqui o ID do canal que JÁ EXISTE no servidor para esta área
  // (copiar ID do canal no Discord). O setup usa esse canal em vez de criar um
  // novo — não duplica categoria/canal que a torcida já tem. Só cria um canal
  // novo (dentro de 🏛️ DEPARTAMENTOS) quando canalId ficar null.
  departamentos: [
    { slug: 'financeiro', nome: 'Financeiro', emoji: '💰', descricao: 'Controla o caixa da torcida: mensalidade, loja, eventos e rifas — tudo em dinheiro do jogo.', canalId: null },
    { slug: 'social', nome: 'Social e Eventos', emoji: '🎉', descricao: 'Organiza eventos e festas da torcida, e cuida das rifas.', canalId: null },
    { slug: 'loja', nome: 'Materiais e Loja', emoji: '🛍️', descricao: 'Cuida do catálogo, do estoque e do atendimento dos pedidos da loja.', canalId: null },
    { slug: 'comunicacao', nome: 'Comunicação', emoji: '📣', descricao: 'Cuida dos avisos oficiais e modera os registros da memória da torcida.', canalId: null },
    { slug: 'patrimonio', nome: 'Patrimônio', emoji: '🗃️', descricao: 'Inventário da torcida: material de jogo, eletrônicos e mobiliário.', canalId: null },
    { slug: 'bandeiras', nome: 'Bandeiras', emoji: '🚩', descricao: 'Cuida das bandeiras, faixas e mastros da torcida.', canalId: null },
    { slug: 'bateria', nome: 'Bateria', emoji: '🥁', descricao: 'Organiza os ensaios e cuida dos instrumentos da bateria.', canalId: null },
    { slug: 'caravanas', nome: 'Caravanas', emoji: '🚌', descricao: 'Organiza as viagens para jogos fora: veículos, vagas e embarque.', canalId: null },
    { slug: 'feminino', nome: 'Feminino', emoji: '🌹', descricao: 'Espaço e organização do departamento feminino da torcida.', canalId: null },
    { slug: 'carnaval', nome: 'Carnaval', emoji: '🎭', descricao: 'Organiza a participação da torcida no carnaval.', canalId: null },
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
    // Canal novo na lista faz a sincronização inicial ler o histórico INTEIRO
    // dele uma vez (ver ingestao.sincronizarCanal). Os nomes aqui são os do
    // Discord (conferidos pela API em 2026-09-13) e aparecem nos painéis como
    // origem do dado. Todos precisam estar dentro de `categoriaLogs` — ver
    // comentário logo abaixo.
    canais: ['1531478268975251496', '1439061028515090524', '1198743171765637123', '1518021496662917216'],
    // Categoria "⏰・LOGS HOOLIBRAS" (conferida pela API em 2026-09-13) — todo
    // canal em `canais` PRECISA estar dentro dela; ingestao.sincronizarCanaisDeLog
    // recusa e avisa qualquer um que não esteja. Existia um 5º canal aqui,
    // `1461544673825783929` ("logs-liderança"), que na verdade mora na
    // categoria "⏰・LOGS FANÁTICOS/ARENA" — outra comunidade, mesmo servidor
    // Discord. 2.970 registros (fechadura, novato_entrou, advertido, roupa,
    // banco...) de lá vieram misturados com os do Hoolibras por 2 meses até
    // ser notado (2026-09-13), contaminando painéis como fechaduras (estado
    // "sem log recente" de fechaduras que nem existem aqui) e o alerta de
    // novato. Removido da lista; os registros antigos ficam no banco pra
    // quem quiser investigar, mas nenhuma consulta nova deve incluir
    // `canal_id = '1461544673825783929'`.
    categoriaLogs: '1356017370304348251',
    nomesCanais: {
      '1531478268975251496': 'logs-painel',     // entrada/saída do servidor
      // "#ID Nome ..." — recrutou, promoveu, expulsou, tag, blacklist,
      // impedimento, multa, arena, sede/portão, config
      '1439061028515090524': 'logs-registros',
      '1198743171765637123': 'logs-baú',        // Guardou/Removeu [baú]
      '1518021496662917216': 'logs-banco',      // Coins (dominação de território)
    },
    // Fonte sem log há mais que isso = o painel avisa que o dado pode estar
    // parado (canal de log que o jogo deixou de usar, webhook trocado). Também
    // separa, no painel de fechaduras, "estado atual" de "último estado
    // conhecido".
    fonteParadaDias: 3,
    canalAlertas: '1490536504748150925',
    mencionarAlertas: [cargos.presidente, cargos.vicePresidente, cargos.velhaGuarda, cargos.diretoria, cargos.recrutador],
    // Canal do painel fixo de estatísticas. null = painel desligado.
    canalPainel: null,
    painelIntervaloMin: 30,
    // Canal do painel fixo de jogadores online (entrada/saída do logs-painel).
    canalPainelJogadores: '1548201757820059688', // 📊・painel-jogadores
    painelJogadoresIntervaloMin: 5,
    // Sem uma saída em até tantas horas depois de uma entrada, a sessão se
    // fecha sozinha (o jogo perde saída de vez em quando: queda de conexão,
    // crash, mensagem que não chegou — sem isso o jogador ficaria "online"
    // pra sempre no cálculo). Calibrado pela distribuição real de sessões
    // completas do servidor (2026-09-12): mediana < 1h, p99 ~9,5h, e depois
    // um salto direto pra 238h+ (aí sim é sessão presa, não sessão real) — 24h
    // sobra folga pra sessão longa de verdade sem deixar fantasma "online".
    presencaSessaoMaxHoras: 24,
    // Saída seguida de entrada do MESMO jogador em até tantos minutos conta
    // como a mesma sessão continuando (queda de conexão, loading screen),
    // não como duas visitas. Calibrado pela distribuição real de reconexões
    // (2026-09-12): reconexão de verdade é rara e rápida (130 em 5.998 levam
    // menos de 2 min); a esmagadora maioria fica na casa das horas — 2 min
    // nunca funde duas visitas de fato distintas.
    presencaReconexaoFolgaMin: 2,
    inatividadeDias: 7,
    novatoSemRecrutamentoDias: 3, // alerta quem entrou no jogo e não pediu recrutamento após N dias
    // Baú da torcida (canal logs-baú). O saldo por item só pode ser LÍQUIDO
    // (guardou − removeu) a partir do primeiro log lido: o jogo não informa o
    // estoque inicial, então o painel diz "desde <data>", nunca "estoque".
    bau: {
      // Retirada de uma vez acima disso vira alerta na hora (o maior caso real
      // observado até 2026-09-13 foi 5.477 de tecido pela Presidência).
      alertaRetiradaQtd: 500,
    },
    // Banco da torcida (depósito/saque nos logs de liderança). Saque acima
    // disso vira alerta na hora.
    caixa: {
      alertaSaqueValor: 100000,
    },
  },

  // Conta hackeada espalhando golpe pelo servidor (ver utils/antiSpam).
  // Liderança, cargosIsentos e gestores de departamento nunca entram na detecção.
  antiSpam: {
    // 'alerta' = só avisa no canal quem TERIA sido pego (botão NÃO ERA SPAM pra
    // marcar falso positivo); 'punir' = castiga e apaga sozinho. Em modo alerta
    // desde 2026-09-13: revisar os alertas por ~1 semana antes de trocar.
    modo: 'alerta',
    // Alta certeza (os mesmos arquivos em vários canais — padrão real: 4 imagens
    // em 5–6 canais): APAGA sozinho mesmo em modo alerta, sem castigo.
    altaCerteza: { janelaSegundos: 60, arquivosMinimos: 2, canaisMinimos: 4 },
    cargosIsentos: [cargos.recrutador], // atende vários tickets ao mesmo tempo
    janelaSegundos: 30,
    canaisMesmaMensagem: 3,    // mesma mensagem (texto ≥10 caracteres, link ou anexo) em N canais na janela
    canaisQualquerMensagem: 5, // mensagens COM link ou anexo em N canais na janela (spammer que muda o texto)
    historicoSegundos: 120,    // ao pegar, apaga tudo que ele mandou nesse período
    apagarNaHoraSegundos: 60,  // depois de pego, o que ele ainda mandar some na hora
    castigoHoras: 24,
    castigoManualDias: 7, // botão CASTIGO no alerta — usado em modo alerta pra já bloquear a conta sem banir
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
