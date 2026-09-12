// Regras puras da escala (sem Discord nem banco).
// Uma pessoa, um posto por operação; presença não é campo da escala.

const FUNCOES_ESCALA = {
  COORDENACAO: { rotulo: 'Coordenação', emoji: '🎖️' },
  CONDUCAO: { rotulo: 'Condução', emoji: '🚦' },
  EMBARQUE: { rotulo: 'Embarque', emoji: '🎫' },
  BANDEIRA: { rotulo: 'Bandeira', emoji: '🚩' },
  BATERIA: { rotulo: 'Bateria', emoji: '🥁' },
  ACOLHIMENTO: { rotulo: 'Acolhimento', emoji: '🤝' },
  COBERTURA: { rotulo: 'Cobertura (fotos e vídeo)', emoji: '📸' },
  APOIO: { rotulo: 'Apoio', emoji: '🛠️' },
};
const FUNCAO_CHOICES = Object.entries(FUNCOES_ESCALA).map(([value, f]) => ({ name: f.rotulo, value }));
const ICONE_STATUS = { CONVOCADO: '⏳', ACEITO: '✅', RECUSADO: '❌' };

function rotuloFuncao(funcao) {
  const f = FUNCOES_ESCALA[funcao] ?? FUNCOES_ESCALA.APOIO;
  return `${f.emoji} ${f.rotulo}`;
}

function pendenciasEscala({ escala, inicioEm, agora = new Date() }) {
  const pendencias = [];
  const ativos = escala.filter(e => e.status !== 'RECUSADO');
  if (!escala.length) {
    pendencias.push({ gravidade: 'alta', texto: 'Escala vazia: ninguém convocado.' });
  } else if (!ativos.some(e => e.funcao === 'COORDENACAO')) {
    pendencias.push({ gravidade: 'alta', texto: 'Sem coordenação: ninguém responde pela operação.' });
  }
  const horasAteInicio = (new Date(inicioEm).getTime() - agora.getTime()) / 3600000;
  const semResposta = escala.filter(e => e.status === 'CONVOCADO').length;
  if (horasAteInicio > 0 && horasAteInicio <= 48 && semResposta) {
    pendencias.push({ gravidade: 'media', texto: `${semResposta} convocado${semResposta !== 1 ? 's' : ''} sem resposta a menos de 48h.` });
  }
  const recusas = escala.filter(e => e.status === 'RECUSADO').length;
  if (recusas) pendencias.push({ gravidade: 'media', texto: `${recusas} recusa${recusas !== 1 ? 's' : ''} a cobrir.` });
  return pendencias;
}

function textoPendencias(pendencias) {
  return pendencias.map(p => `${p.gravidade === 'alta' ? '🔴' : '🟡'} ${p.texto}`).join('\n');
}

module.exports = { FUNCOES_ESCALA, FUNCAO_CHOICES, ICONE_STATUS, rotuloFuncao, pendenciasEscala, textoPendencias };
