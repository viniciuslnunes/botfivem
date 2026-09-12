// Regras puras da memória (linha do tempo da torcida por dia civil de São Paulo).
const { chaveDia } = require('../logsJogo/estatisticas');

const DIA_MS = 24 * 60 * 60 * 1000;
const pad = n => String(n).padStart(2, '0');

// "hoje", "DD/MM" ou "DD/MM/AAAA"
function parseDiaMemoria(texto, agora = new Date()) {
  const t = String(texto ?? '').trim().toLowerCase();
  if (!t || t === 'hoje') return chaveDia(agora);
  const m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (!m) return null;
  const ano = m[3] ? Number(m[3]) : Number(chaveDia(agora).slice(0, 4));
  const chave = `${ano}-${pad(m[2])}-${pad(m[1])}`;
  const data = new Date(`${chave}T12:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === chave ? chave : null;
}

// Janela: até N anos atrás e até M dias à frente
function validarDiaMemoria(chave, agora = new Date(), { anosMax = 5, diasFuturoMax = 90 } = {}) {
  if (!chave) return { ok: false, mensagem: '❌ DATA INVÁLIDA. USE `DD/MM/AAAA`, `DD/MM` OU `hoje`.' };
  const hoje = new Date(`${chaveDia(agora)}T12:00:00Z`);
  const dia = new Date(`${chave}T12:00:00Z`);
  if (dia.getTime() > hoje.getTime() + diasFuturoMax * DIA_MS) return { ok: false, mensagem: `❌ A MEMÓRIA ACEITA NO MÁXIMO ${diasFuturoMax} DIAS À FRENTE.` };
  const minimo = new Date(hoje);
  minimo.setUTCFullYear(minimo.getUTCFullYear() - anosMax);
  if (dia.getTime() < minimo.getTime()) return { ok: false, mensagem: `❌ A MEMÓRIA VOLTA NO MÁXIMO ${anosMax} ANOS.` };
  return { ok: true };
}

// Fato de dia que já passou é "atrasado": passa por aprovação. Hoje e futuro entram na hora.
function statusInicialDoFato(chave, agora = new Date()) {
  return chave < chaveDia(agora) ? 'PENDENTE' : 'APROVADA';
}

function formatarDia(chave) {
  const [ano, mes, dia] = chave.split('-');
  return `${dia}/${mes}/${ano}`;
}

function tituloDoDia(chave) {
  return `📅 ${formatarDia(chave)}`;
}

module.exports = { parseDiaMemoria, validarDiaMemoria, statusInicialDoFato, formatarDia, tituloDoDia };
