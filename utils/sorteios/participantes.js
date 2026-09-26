const config = require('../../config/index.js');
const relatorios = require('../logsJogo/relatorios');
const logs = require('../logsJogo/repositorio');
const P = require('../logsJogo/presenca');
const { periodoDoDia } = require('../logsJogo/registrosDiarios');
const { normalizarNome } = require('../nomes');
const repo = require('./repositorio');
const { filtrarElegiveis } = require('./regras');

const LIMITE_SESSAO_MS = config.logsJogo.presencaSessaoMaxHoras * 60 * 60 * 1000;

// Quem colou no dia: os mesmos jogadores distintos do canal registros-diarios
// (relatorios.montarDadosPresenca), com as regras de elegibilidade aplicadas
// ANTES de numerar (quem sai não ocupa número):
//   • minMinutos: tempo mínimo online no dia;
//   • excluirDias: quem ganhou em sorteio concluído nos últimos N dias fica de fora.
// O Discord de cada um vem do apelido do sócio ("S GDF | Nome - 1234"): sem
// vínculo, o ganhador sai só pelo nome e ID do jogo (o ID troca por season, então
// o vínculo é atalho para marcar/avisar; o sorteio não depende dele).
async function participantesDoDia(dia, client, { minMinutos = null, excluirDias = null } = {}) {
  const dados = await relatorios.montarDadosPresenca(periodoDoDia(dia), { listaCumulativa: true, semContextoGlobal: true });

  let porIdFivem = new Map();
  try {
    ({ porIdFivem } = await require('../inteligencia/pessoas').carregarSocios(client));
  } catch (err) {
    console.error('[sorteios] não consegui ligar os jogadores aos sócios do Discord:', err.message);
  }
  const discordPorId = new Map([...porIdFivem].map(([id, s]) => [id, s.discordId]));

  let ganhadoresRecentes = null;
  if (excluirDias) {
    const rec = await repo.ganhadoresRecentes(excluirDias);
    ganhadoresRecentes = {
      ids: new Set(rec.map(r => String(r.id_jogo))),
      discords: new Set(rec.map(r => r.discord_id).filter(Boolean)),
      nomes: new Set(rec.map(r => normalizarNome(r.nome)).filter(Boolean)),
    };
  }

  const { elegiveis, excluidosMinimo, excluidosRecentes } = filtrarElegiveis(dados.entradas, {
    minMinutos, ganhadoresRecentes, discordPorId, normalizar: normalizarNome,
  });
  return {
    participantes: elegiveis.map(p => ({ ...p, discordId: discordPorId.get(p.id) ?? null })),
    excluidosMinimo,
    excluidosRecentes,
  };
}

// IDs do jogo que estão com o jogo aberto agora (sessão viva). Falha = ninguém
// marcado online (a informação é só um apoio, nunca bloqueia o sorteio).
async function idsOnlineAgora(agora = new Date()) {
  try {
    const estado = await logs.estadoDosJogadores(agora);
    return new Set(P.listaOnline(P.estadoSemSessoesExpiradas(estado, LIMITE_SESSAO_MS, agora)).map(e => String(e.id)));
  } catch (err) {
    console.error('[sorteios] não consegui ver quem está online:', err.message);
    return new Set();
  }
}

module.exports = { participantesDoDia, idsOnlineAgora };
