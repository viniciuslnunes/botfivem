// Regras puras da carteirinha (sem Discord nem banco).
const { chaveDia } = require('../logsJogo/estatisticas');

const DIA_MS = 24 * 60 * 60 * 1000;

// A coluna validade pode chegar como Date (tipo DATE do Postgres, meia-noite local) ou texto
function chaveDataValidade(validade) {
  if (validade == null || validade === '') return null;
  if (validade instanceof Date) {
    if (Number.isNaN(validade.getTime())) return null;
    const mes = String(validade.getMonth() + 1).padStart(2, '0');
    const dia = String(validade.getDate()).padStart(2, '0');
    return `${validade.getFullYear()}-${mes}-${dia}`;
  }
  const m = String(validade).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function paraUTC(chave) {
  const [ano, mes, dia] = chave.split('-').map(Number);
  return Date.UTC(ano, mes - 1, dia);
}

// Vigente, vencendo (até N dias) ou vencida — derivado na leitura, nunca gravado
function situacaoCarteirinha(validade, agora = new Date(), vencendoDias = 30) {
  const vencimento = chaveDataValidade(validade);
  if (!vencimento) return { situacao: 'SEM_VALIDADE', dias: null, validade: null };
  const dias = Math.round((paraUTC(vencimento) - paraUTC(chaveDia(agora))) / DIA_MS);
  if (dias < 0) return { situacao: 'VENCIDA', dias, validade: vencimento };
  if (dias <= vencendoDias) return { situacao: 'VENCENDO', dias, validade: vencimento };
  return { situacao: 'VIGENTE', dias, validade: vencimento };
}

// Renovar antes de vencer não perde os dias que faltavam; vencida conta a partir de hoje
function novaValidadeRenovacao(validadeAtual, agora = new Date()) {
  const hoje = chaveDia(agora);
  const atual = chaveDataValidade(validadeAtual);
  const base = atual && atual > hoje ? atual : hoje;
  const [ano, mes, dia] = base.split('-').map(Number);
  return new Date(Date.UTC(ano + 1, mes - 1, dia)).toISOString().slice(0, 10);
}

function formatarDataBR(chave) {
  const [ano, mes, dia] = chave.split('-');
  return `${dia}/${mes}/${ano}`;
}

function textoSituacao(s) {
  const plural = n => (n !== 1 ? 'S' : '');
  switch (s.situacao) {
    case 'VIGENTE': return `🟢 VIGENTE ATÉ ${formatarDataBR(s.validade)}`;
    case 'VENCENDO': return s.dias === 0 ? '🟡 VENCE HOJE' : `🟡 VENCE EM ${s.dias} DIA${plural(s.dias)}`;
    case 'VENCIDA': return `🔴 VENCIDA HÁ ${-s.dias} DIA${plural(-s.dias)}`;
    default: return '⚪ SEM VALIDADE REGISTRADA';
  }
}

module.exports = { chaveDataValidade, situacaoCarteirinha, novaValidadeRenovacao, formatarDataBR, textoSituacao };
