// Catálogo do onboarding: para cada cargo, canal e categoria que um tenant pode
// precisar, o nome padrão (usado ao CRIAR) e os apelidos (usados ao PROCURAR
// algo que a torcida já tem no servidor). Quais chaves valem para uma torcida
// é decidido pelos módulos ligados (manifesto.exige); aqui só se descreve cada uma.

// tipo: 'texto' (canal de texto) — todos os canais do bot são de texto.
const CARGOS = {
  socio: { nome: 'SÓCIO', apelidos: ['socio', 'socios'] },
  presidente: { nome: 'PRESIDENTE', apelidos: ['presidente', 'presidencia'] },
  vicePresidente: { nome: 'VICE PRESIDENTE', apelidos: ['vice presidente', 'vice-presidente', 'vice'] },
  velhaGuarda: { nome: 'VELHA GUARDA', apelidos: ['velha guarda'] },
  diretoria: { nome: 'DIRETORIA', apelidos: ['diretoria', 'diretor', 'diretores'] },
  recrutador: { nome: 'RECRUTADOR', apelidos: ['recrutador', 'recrutadores', 'equipe recrutamento'] },
  visitante: { nome: 'VISITANTE', apelidos: ['visitante', 'visitantes'] },
  provarManto: { nome: 'PROVAR MANTO', apelidos: ['provar manto', 'provando manto'] },
  reprovadoRecrutamento: { nome: 'REPROVADO NO RECRUTAMENTO', apelidos: ['reprovado', 'reprovado recrutamento', 'reprovado no recrutamento'] },
  elenco: { nome: 'ELENCO', apelidos: ['elenco'] },
};

// Listas de 3 cargos (nível 1, 2 e 3). Cada posição é mapeada como uma chave.
const CARGOS_EM_LISTA = {
  adv: { nome: n => `ADV ${n}`, apelidos: n => [`adv ${n}`, `adv${n}`, `advertencia ${n}`, `advertencia${n}`], quantidade: 3 },
};

const CANAIS = {
  recrutamento: { nome: 'recrutamento', apelidos: ['recrutamento', 'analise recrutamento'] },
  provarManto: { nome: 'provar-manto', apelidos: ['provar manto'] },
  validarSetagem: { nome: 'validar-setagem', apelidos: ['validar setagem', 'setagem'] },
  validarId: { nome: 'validar-id', apelidos: ['validar id'] },
  naoRecrutar: { nome: 'nao-recrutar', apelidos: ['nao recrutar', 'nao-recrutar'] },
  historicoNaoRecrutar: { nome: 'historico-nao-recrutar', apelidos: ['historico nao recrutar', 'historico bloqueios'] },
  advertencia: { nome: 'advertencia', apelidos: ['advertencia', 'advertencias'] },
  historicoAdv: { nome: 'historico-adv', apelidos: ['historico adv', 'historico advertencias'] },
  advPendentes: { nome: 'adv-pendentes', apelidos: ['adv pendentes', 'advertencias pendentes'] },
  advRecrutadores: { nome: 'adv-recrutadores', apelidos: ['adv recrutadores', 'advertencia recrutadores'] },
  historicoAdvRec: { nome: 'historico-adv-recrutadores', apelidos: ['historico adv recrutadores', 'historico adv rec'] },
  carteirinha: { nome: 'carteirinha', apelidos: ['carteirinha', 'carteirinhas'] },
  mural: { nome: 'mural-de-associados', apelidos: ['mural', 'mural de associados', 'associados'] },
  ticket: { nome: 'ticket', apelidos: ['ticket', 'tickets', 'abrir ticket'] },
  logsTicket: { nome: 'logs-ticket', apelidos: ['logs ticket', 'log ticket', 'transcript'] },
  hierarquia: { nome: 'hierarquia', apelidos: ['hierarquia'] },
  elenco: { nome: 'elenco', apelidos: ['elenco'] },
  quadroRecrutadores: { nome: 'quadro-de-recrutadores', apelidos: ['quadro de recrutadores', 'quadro recrutadores'] },
  topRecrutadores: { nome: 'top-recrutadores', apelidos: ['top recrutadores', 'ranking recrutadores'] },
  alertaNovatos: { nome: 'alerta-novatos', apelidos: ['alerta novatos', 'novatos'] },
  telefoneSocio: { nome: 'telefone-socios', apelidos: ['telefone socios', 'telefones', 'telefone'] },
  antiSpam: { nome: 'anti-spam', apelidos: ['anti spam', 'antispam'] },
  associadoEmAtencao: { nome: 'associado-em-atencao', apelidos: ['associado em atencao', 'associados em atencao'] },
  logsLideranca: { nome: 'logs-lideranca', apelidos: ['logs lideranca'] },
};

const CATEGORIAS = {
  tickets: { nome: 'TICKETS', apelidos: ['tickets', 'ticket', 'atendimento'] },
};

// Canais que todo mundo pode ver. Os demais nascem privados (só liderança e o
// bot): advertência, bloqueio de ID, logs e recrutamento não são para o público.
const CANAIS_PUBLICOS = new Set(['ticket', 'carteirinha', 'mural', 'hierarquia', 'elenco']);

// Sem o "ã", sem emoji, sem pontuação: "🦅・Sócios" e "socios" viram a mesma coisa.
function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

module.exports = { CARGOS, CARGOS_EM_LISTA, CANAIS, CATEGORIAS, CANAIS_PUBLICOS, normalizar };
