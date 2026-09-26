// Regras puras da confiança (sem Discord nem banco).
// Confiança NÃO concede permissão. Sinais caros (presença, admissão); post e
// reação não contam. Queda rápida, subida lenta. Score privado; nível visível.

const DIA_MS = 24 * 60 * 60 * 1000;

const SINAIS_CONFIANCA = {
  PRESENCA: { peso: 15, teto: 45, janelaDias: 30, rotulo: 'Presença em evento' },
  APROVACAO: { peso: 20, rotulo: 'Admissão aprovada' },
  REPROVACAO: { peso: -40, rotulo: 'Solicitação reprovada' },
  RIFA_ACERTO: { peso: 20, teto: 20, janelaDias: 30, rotulo: 'Acerto de rifa em dia' },
  // Conduta (alimentados pela varredura de inteligência; teto negativo = piso da queda)
  ADV_SOCIO: { peso: -15, teto: -45, janelaDias: 90, rotulo: 'Advertência de sócio' },
  ADV_PAGA_EM_DIA: { peso: 10, teto: 20, janelaDias: 90, rotulo: 'Advertência paga no prazo' },
  ADV_VENCIDA: { peso: -30, rotulo: 'Advertência vencida sem pagar' },
  RESTRICAO_JOGO: { peso: -20, teto: -40, janelaDias: 90, rotulo: 'Restrição no jogo' },
  NOVATO_ATIVO: { peso: 10, rotulo: 'Ativo na primeira semana' },
  TEMPO_DE_CASA: { peso: 10, rotulo: 'Tempo de casa (a cada 60 dias, até 3×)' },
};

const NIVEIS_CONFIANCA = [
  { nivel: 0, minimo: 0, rotulo: 'Novato', emoji: '🌱' },
  { nivel: 1, minimo: 20, rotulo: 'Conhecido', emoji: '🦅' },
  { nivel: 2, minimo: 50, rotulo: 'De casa', emoji: '🏠' },
  { nivel: 3, minimo: 80, rotulo: 'Referência', emoji: '⭐' },
];

// Liderança opera desde o dia 1: piso de nível, sem inflar o score
const PISO_NIVEL_LIDERANCA = 2;

// Teto positivo limita a subida; teto negativo limita a queda (a soma nunca passa dele)
const limitar = (soma, teto) => (teto >= 0 ? Math.min(soma, teto) : Math.max(soma, teto));

// eventos: [{ sinal, peso, criado_em }]
function calcularScore(eventos, agora = new Date()) {
  const porSinal = new Map();
  for (const e of eventos) {
    if (!porSinal.has(e.sinal)) porSinal.set(e.sinal, []);
    porSinal.get(e.sinal).push(e);
  }
  let total = 0;
  for (const [sinal, lista] of porSinal) {
    const def = SINAIS_CONFIANCA[sinal];
    const soma = itens => itens.reduce((s, e) => s + Number(e.peso), 0);
    if (!def?.janelaDias) {
      total += soma(lista);
      continue;
    }
    // Na janela: soma com teto. Fora dela: conta metade, com o mesmo teto (subida lenta)
    const limite = agora.getTime() - def.janelaDias * DIA_MS;
    const recentes = lista.filter(e => new Date(e.criado_em).getTime() >= limite);
    const antigos = lista.filter(e => new Date(e.criado_em).getTime() < limite);
    total += limitar(soma(recentes), def.teto) + limitar(soma(antigos) * 0.5, def.teto);
  }
  return Math.max(0, Math.min(100, Math.round(total)));
}

function nivelDoScore(score) {
  return [...NIVEIS_CONFIANCA].reverse().find(n => score >= n.minimo) ?? NIVEIS_CONFIANCA[0];
}

function nivelEfetivo(score, { lideranca = false } = {}) {
  const peloScore = nivelDoScore(score);
  return lideranca && peloScore.nivel < PISO_NIVEL_LIDERANCA ? NIVEIS_CONFIANCA[PISO_NIVEL_LIDERANCA] : peloScore;
}

// "Faltam N" só aparece para a própria pessoa
function progresso(score) {
  const proximo = NIVEIS_CONFIANCA.find(n => n.minimo > score);
  return proximo ? { proximo, faltam: proximo.minimo - score } : null;
}

function rotuloNivel(n) {
  return `${n.emoji} ${n.rotulo}`;
}

module.exports = { SINAIS_CONFIANCA, NIVEIS_CONFIANCA, calcularScore, nivelDoScore, nivelEfetivo, progresso, rotuloNivel };
