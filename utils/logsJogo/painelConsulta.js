// Lista de períodos compartilhada pelos canais-painel de log — mesma ordem (do
// mais recente/curto pro mais antigo/longo) do painel de jogadores. "Ontem"
// fica de fora: nestes painéis a pergunta é sempre "quanto nos últimos N
// dias", não "o que houve num dia civil".
//
// O mecanismo de consulta em si (registrar renderizador, handler único
// `logstat:<slug>`) foi substituído pelo padrão interativo — ver
// painelComponentesFixos.js e docs/inteligencia-logs-jogo.md § "Padrão de UI".
// Só esta lista sobrou daqui: todo canal migrado monta o próprio select com o
// customId do seu módulo.
const PERIODOS = [
  { chave: 'hoje', label: 'HOJE' },
  { chave: '7d', label: 'ÚLTIMOS 7 DIAS' },
  { chave: '30d', label: 'ÚLTIMOS 30 DIAS' },
  { chave: '90d', label: 'ÚLTIMOS 90 DIAS' },
  { chave: '365d', label: 'ÚLTIMOS 12 MESES' },
  { chave: 'tudo', label: 'TODO O HISTÓRICO' },
];

module.exports = { PERIODOS };
