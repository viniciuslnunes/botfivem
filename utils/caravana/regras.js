// Regras puras da caravana (sem Discord nem banco).
// Capacidade é do veículo; uma pessoa, um veículo; excluir veículo desaloca, não remove da caravana.

function podeAlocarNoVeiculo({ capacidade, alocados, jaNesteVeiculo }) {
  if (jaNesteVeiculo) return { ok: false, mensagem: '⚠️ ESTA PESSOA JÁ ESTÁ NESTE VEÍCULO.' };
  if (alocados >= capacidade) return { ok: false, mensagem: `❌ VEÍCULO LOTADO (${alocados}/${capacidade}). REALOQUE ALGUÉM OU USE OUTRO VEÍCULO.` };
  return { ok: true };
}

// confirmados: [{ discord_id, veiculo_id }]
function pendenciasCaravana({ veiculos, confirmados, inicioEm, agora = new Date() }) {
  const pendencias = [];
  if (!veiculos.length) {
    pendencias.push({ gravidade: 'alta', texto: 'Nenhum veículo cadastrado.' });
  } else {
    const assentos = veiculos.reduce((s, v) => s + Number(v.capacidade), 0);
    if (confirmados.length > assentos) {
      pendencias.push({ gravidade: 'alta', texto: `Faltam ${confirmados.length - assentos} assento${confirmados.length - assentos !== 1 ? 's' : ''} para os confirmados.` });
    }
    const semResponsavel = veiculos.filter(v => !v.responsavel_id).length;
    if (semResponsavel) pendencias.push({ gravidade: 'media', texto: `${semResponsavel} veículo${semResponsavel !== 1 ? 's' : ''} sem responsável.` });
  }
  const horas = (new Date(inicioEm).getTime() - agora.getTime()) / 3600000;
  const semVeiculo = confirmados.filter(c => !c.veiculo_id).length;
  if (horas > 0 && horas <= 72 && semVeiculo && veiculos.length) {
    pendencias.push({ gravidade: 'alta', texto: `${semVeiculo} confirmado${semVeiculo !== 1 ? 's' : ''} ainda sem veículo a menos de 72h.` });
  }
  return pendencias;
}

// checkins: [{ discord_id, trecho }]
function resumirEmbarque(checkins) {
  const ida = new Set(checkins.filter(c => c.trecho === 'IDA').map(c => c.discord_id));
  const volta = new Set(checkins.filter(c => c.trecho === 'VOLTA').map(c => c.discord_id));
  return { ida, volta, voltaSemIda: [...volta].filter(id => !ida.has(id)) };
}

module.exports = { podeAlocarNoVeiculo, pendenciasCaravana, resumirEmbarque };
