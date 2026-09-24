// Lista ordenada de módulos do bot. A ORDEM é a dos hooks (quem vê a mensagem
// primeiro, quem sobe primeiro): logsJogo consome as mensagens de log antes do
// anti-spam, que roda antes dos comandos de texto e dos botões de validar ID.
// Cada arquivo só carrega o próprio código quando o módulo está ligado
// (require preguiçoso dentro de carregar()/hooks), então módulo desligado não
// registra comando, handler, painel nem tabela.
//
// Módulo novo: crie modulos/<id>.js (contrato em plataforma/contrato.js) e
// acrescente aqui. Um teste falha se um arquivo de commands/ ficar sem dono.
module.exports = [
  require('./nucleo'),
  require('./setup'),
  require('./departamentos'),
  require('./logsJogo'),
  require('./antiSpam'),
  require('./sociais'),
  require('./bloqueioId'), // por último entre os de mensagem: o botão de validar ID vem depois do anti-spam
  // Canais de inteligência de log (na ordem em que sobem)
  require('./painelBau'),
  require('./painelCaixa'),
  require('./painelDisciplina'),
  require('./painelRestricoes'),
  require('./painelFechaduras'),
  require('./painelTags'),
  require('./painelTerritorio'),
  require('./painelRecrutadores'),
  require('./painelFarm'),
  require('./painelHistorico'),
  // Eventos e o que se apoia neles
  require('./eventos'),
  require('./confianca'),
  require('./escala'),
  require('./financeiro'),
  require('./caravana'),
  require('./loja'),
  require('./rifas'),
  require('./patrimonio'),
  require('./memoria'),
  // Pessoas e hierarquia
  require('./carteirinha'),
  require('./hierarquia'),
  require('./elenco'),
  require('./ticket'),
  require('./advertencia'),
  require('./advertenciaRecrutador'),
  require('./recrutamento'),
  require('./testes'),
];
