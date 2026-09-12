// Regras puras da agenda (sem Discord nem banco).
const { chaveDia } = require('../logsJogo/estatisticas');

const DIA_MS = 24 * 60 * 60 * 1000;

// Caravana e ensaio são modos do evento, não sistemas paralelos
const TIPOS_EVENTO = {
  GERAL: { rotulo: 'Evento', emoji: '📅' },
  CARAVANA: { rotulo: 'Caravana', emoji: '🚌' },
  ENSAIO: { rotulo: 'Ensaio da bateria', emoji: '🥁' },
};
const TIPO_CHOICES = Object.entries(TIPOS_EVENTO).map(([value, t]) => ({ name: t.rotulo, value }));

const pad = n => String(n).padStart(2, '0');

// "20/09 19:30", "20/09/2026 19h30", "20/09 às 19h" — horário de São Paulo
function parseDataHora(texto, agora = new Date()) {
  const m = String(texto ?? '').trim()
    .match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\s*(?:às|as|,|-)?\s*(\d{1,2})(?::|h)(\d{2})?$/i);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const hora = Number(m[4]);
  const minuto = m[5] ? Number(m[5]) : 0;
  let ano = m[3] ? Number(m[3]) : null;
  if (ano !== null && ano < 100) ano += 2000;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hora > 23 || minuto > 59) return null;

  const montar = a => {
    const chave = `${a}-${pad(mes)}-${pad(dia)}`;
    const data = new Date(`${chave}T${pad(hora)}:${pad(minuto)}:00-03:00`);
    return Number.isNaN(data.getTime()) || chaveDia(data) !== chave ? null : data;
  };
  if (ano !== null) return montar(ano);

  // Sem ano: se a data já passou há mais de um dia, é do ano que vem
  const anoAtual = Number(chaveDia(agora).slice(0, 4));
  const candidato = montar(anoAtual);
  if (candidato && candidato.getTime() < agora.getTime() - DIA_MS) return montar(anoAtual + 1);
  return candidato;
}

// Lotou, entra na lista de espera
function decidirInscricao({ capacidade, confirmados }) {
  return capacidade == null || confirmados < capacidade ? 'CONFIRMADO' : 'ESPERA';
}

function inscricoesAbertas(evento, agora = new Date()) {
  return evento.status === 'ATIVO' && new Date(evento.inicio_em).getTime() > agora.getTime();
}

function datasDaSerie(inicio, semanas, maxSemanas = 12) {
  const total = Math.min(Math.max(0, Number(semanas) || 0), maxSemanas);
  return Array.from({ length: total + 1 }, (_, i) => new Date(inicio.getTime() + i * 7 * DIA_MS));
}

// Taxa de presença = presentes / confirmados. Quem apareceu sem confirmar conta
// como presente, então a taxa pode passar de 100%; no-show = confirmado que não veio.
function resumirPresenca(inscricoes) {
  const confirmados = inscricoes.filter(i => i.status === 'CONFIRMADO');
  const presentes = inscricoes.filter(i => i.presente_em);
  const confirmadosPresentes = confirmados.filter(i => i.presente_em).length;
  return {
    confirmados: confirmados.length,
    espera: inscricoes.filter(i => i.status === 'ESPERA').length,
    presentes: presentes.length,
    avulsos: presentes.filter(i => i.status !== 'CONFIRMADO').length,
    noShow: confirmados.length - confirmadosPresentes,
    taxa: confirmados.length ? presentes.length / confirmados.length : null,
  };
}

function formatarTaxa(taxa) {
  return taxa == null ? '—' : `${Math.round(taxa * 100)}%`;
}

module.exports = {
  TIPOS_EVENTO,
  TIPO_CHOICES,
  parseDataHora,
  decidirInscricao,
  inscricoesAbertas,
  datasDaSerie,
  resumirPresenca,
  formatarTaxa,
};
