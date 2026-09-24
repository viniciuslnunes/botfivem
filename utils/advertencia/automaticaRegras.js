// Advertência automática de sócio: regras puras (sem Discord nem banco).
// O que o painel do jogo registra (impedimento, advertência) vira advertência no
// Discord; a escada é sempre a mesma:
//   1ª  aviso formal com a justificativa
//   2ª  pagamento no baú em PRAZO_PAGAMENTO_MS (senão perde o cargo de sócio)
//   3ª  perde o cargo de sócio
const PRAZO_PAGAMENTO_MS = 2 * 24 * 60 * 60 * 1000;
// item (normalizado, sem acento) → quantidade exigida na 2ª advertência
const PAGAMENTO_2A = Object.freeze({ maconha: 50, cocaina: 50 });
// Log mais velho que isso não abre advertência (reprocessamento não pune de novo)
const IDADE_MAX_GATILHO_MS = 6 * 60 * 60 * 1000;
// impedimento e advertência do jogo costumam vir juntos: uma só advertência por janela
const JANELA_DUPLICADA_MS = 10 * 60 * 1000;

const ABRE = Object.freeze({ impedimento_adicionou: 'impedimento', advertido: 'advertido' });
const FECHA = Object.freeze({ impedimento_removeu: 'impedimento', adv_removida: 'advertido' });

const semAcento = texto => String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function gatilho(registro, agora = new Date()) {
  const abre = ABRE[registro.acao];
  const fecha = FECHA[registro.acao];
  if (!abre && !fecha) return null;
  if (!registro.alvoIdFivem) return null; // "#nil": sem alvo não dá pra achar o sócio
  if (abre) {
    const idade = agora - new Date(registro.ocorridoEm ?? agora);
    if (idade > IDADE_MAX_GATILHO_MS) return null;
    return { tipo: 'abrir', origem: abre, idFivem: registro.alvoIdFivem };
  }
  return { tipo: 'fechar', origem: fecha, idFivem: registro.alvoIdFivem };
}

// Qual item de pagamento o depósito no baú representa (ou null)
function itemDePagamento(registro) {
  if (registro.acao !== 'bau_guardou' || !registro.atorIdFivem) return null;
  const nome = semAcento(registro.alvoNome);
  return Object.keys(PAGAMENTO_2A).find(item => nome.includes(item)) ?? null;
}

// Soma o depósito e diz o que ainda falta; `quitado` só com todos os itens completos
function aplicarPagamento(pago, item, quantidade) {
  const novo = { ...pago, [item]: (Number(pago[item]) || 0) + (Number(quantidade) || 0) };
  const falta = {};
  for (const [nome, exigido] of Object.entries(PAGAMENTO_2A)) {
    const restante = exigido - (novo[nome] || 0);
    if (restante > 0) falta[nome] = restante;
  }
  return { pago: novo, falta, quitado: Object.keys(falta).length === 0 };
}

module.exports = {
  PRAZO_PAGAMENTO_MS, PAGAMENTO_2A, IDADE_MAX_GATILHO_MS, JANELA_DUPLICADA_MS,
  gatilho, itemDePagamento, aplicarPagamento,
};
