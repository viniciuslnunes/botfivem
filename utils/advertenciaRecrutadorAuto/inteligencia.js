// Liga a advertência automática ao painel de recrutadores: acrescenta a cada linha
// a situação disciplinar (ADV ativa, carência, mantos errados, fichas incompletas)
// e os riscos da última varredura. Registrado por `modulos/advertenciaRecrutadorAuto`;
// com o módulo desligado o painel só não mostra essas colunas.
const inteligencia = require('../logsJogo/inteligenciaRecrutadores');
const R = require('./regras');
const repo = require('./repositorio');
const { riscosDaUltimaVarredura } = require('./varredura');

const dias = (agora, data) => Math.floor((agora - new Date(data)) / R.DIA_MS);

async function enriquecer(linhas, periodo, agora = new Date()) {
  const desde = new Date(agora.getTime() - R.LIMITES.diasOcorrencias * R.DIA_MS);
  const [ativas, erros, incompletas, cargoDesde] = await Promise.all([
    repo.ativas(), repo.errosDeMantoPorRecrutador(desde), repo.fichasIncompletasPorRecrutador(desde), repo.cargoDesde(),
  ]);
  const ativaPorId = new Map();
  for (const a of ativas) {
    const atual = ativaPorId.get(a.discord_id);
    if (!atual || a.nivel > atual.nivel) ativaPorId.set(a.discord_id, a);
  }
  const riscos = riscosDaUltimaVarredura();

  for (const l of linhas) {
    const ativa = ativaPorId.get(l.discordId);
    const desdeCargo = cargoDesde.get(l.discordId);
    l.advNivel = ativa?.nivel ?? 0;
    l.erros7 = erros.get(l.discordId) ?? 0;
    l.incompletas7 = incompletas.get(l.discordId) ?? 0;
    l.emCarencia = Boolean(desdeCargo) && dias(agora, desdeCargo) < R.LIMITES.diasSemRecrutarJogando;

    const partes = [];
    partes.push(ativa
      ? `${ativa.nivel}ª advertência ativa (${R.REGRAS[ativa.regra]?.rotulo ?? 'INATIVIDADE'})`
      : 'sem advertência ativa');
    if (l.erros7) partes.push(`${l.erros7} manto(s) errado(s) em ${R.LIMITES.diasOcorrencias} dias`);
    if (l.incompletas7) partes.push(`${l.incompletas7} ficha(s) incompleta(s) em ${R.LIMITES.diasOcorrencias} dias`);
    if (desdeCargo) partes.push(`recrutador há ${dias(agora, desdeCargo)} dia(s)${l.emCarencia ? ' (em carência)' : ''}`);
    l.disciplinaTexto = partes.join(' · ');

    for (const risco of riscos.get(l.discordId) ?? []) l.atencao.push(risco.texto);
  }
}

function registrar() {
  inteligencia.registrarEnriquecedor(enriquecer);
}

module.exports = { enriquecer, registrar };
