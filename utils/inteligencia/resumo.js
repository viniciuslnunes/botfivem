// Resumo por associado: junta ADV, restrições do jogo, tempo jogado, baú/banco e lista "não
// recrutar" numa linha (associado_resumo). Tudo que cruza pessoas lê daqui em vez de repetir
// seis consultas. Recalculado pela varredura; nunca decide nada, só informa.
const R = require('./regras');
const repo = require('./repositorio');
const A = require('../logsJogo/analises');

const TIPO_DA_ACAO = acao => A.tipoDaAcao(acao);

const nivelPorCargo = membro => require('../logsJogo/advertenciaDiscord').advertenciaAtivaDoMembro(membro) ?? 0;

// Puro: dados já agrupados de UM sócio → resumo e risco.
function montarResumo(d, agora = new Date()) {
  const ocorrencias = [
    ...(d.advs ?? []).map(a => ({ tipo: 'adv', em: a.em })),
    ...(d.restricoes90 ?? []).map(r => ({ tipo: TIPO_DA_ACAO(r.acao) ?? 'restricao', em: r.em })),
  ];
  const reinc = R.reincidencia(ocorrencias, agora);
  const frio = R.esfriando(d.h7Ms ?? 0, d.h28Ms ?? 0);
  const semAtividadeDias = d.ultimaAtividade
    ? Math.floor((agora - new Date(d.ultimaAtividade)) / R.DIA_MS)
    : null;
  const restricoesAtivas = (d.restricoesAtivas ?? []).map(r => TIPO_DA_ACAO(r.acao)).filter(Boolean);

  const risco = R.riscoDoAssociado({
    advAtivas: d.advAtivas ?? 0,
    restricoesAtivas: restricoesAtivas.length,
    reincidente: reinc.reincidente,
    ocorrencias90: reinc.total,
    pagamentoPendente: Boolean(d.pagamentoPendente),
    esfriando: frio.esfriando,
    naoRecrutar: Boolean(d.naoRecrutar),
    semAtividadeDias,
  });

  return {
    risco,
    dados: {
      advAtivas: d.advAtivas ?? 0,
      nivelMax: d.nivelMax ?? 0,
      pagamentoPendente: Boolean(d.pagamentoPendente),
      restricoesAtivas,
      ocorrencias90: reinc.total,
      reincidente: reinc.reincidente,
      ultimaOcorrenciaEm: reinc.ultimaEm ? reinc.ultimaEm.toISOString() : null,
      h7Ms: d.h7Ms ?? 0,
      h28Ms: d.h28Ms ?? 0,
      esfriando: frio.esfriando,
      semAtividadeDias,
      naoRecrutar: Boolean(d.naoRecrutar),
      bau: { entrou: d.bauEntrou ?? 0, saiu: d.bauSaiu ?? 0 },
      banco: { entrou: d.bancoEntrou ?? 0, saiu: d.bancoSaiu ?? 0 },
      fatores: risco.fatores.map(f => f.texto),
      calculadoEm: agora.toISOString(),
    },
  };
}

// Lê tudo em lote e devolve [{ socio, resumo }]. Não grava (a varredura decide).
async function coletarResumos(client, { agora = new Date(), socios: sociosPre = null } = {}) {
  const { socios } = sociosPre ? { socios: sociosPre } : await require('./pessoas').carregarSocios(client);
  const logs = require('../logsJogo/repositorio');
  const relatorios = require('../logsJogo/relatorios');
  const naoRecrutar = require('../naoRecrutarEspelho');
  const ids = socios.filter(s => s.idFivem).map(s => s.idFivem);

  const periodo = dias => ({ chave: `${dias}d`, rotulo: `${dias} DIAS`, inicio: new Date(agora - dias * R.DIA_MS), fim: agora });
  const [advAtivas, advs, restr90, restrAtivas, bloqueados, bau, banco, t7, t28, ultimas] = await Promise.all([
    repo.advSocioAtivas(), repo.advSocioNaJanela(R.LIMITES.reincidenciaDias),
    repo.restricoesAdicionadas(R.LIMITES.reincidenciaDias), repo.restricoesAtivasPorAlvo(),
    naoRecrutar.ativos().catch(() => []), repo.movimentoBauPorId(28), repo.movimentoBancoPorId(28),
    relatorios.tempoJogadoPorId(periodo(7)), relatorios.tempoJogadoPorId(periodo(28)),
    logs.ultimaAtividadePorIds(ids),
  ]);

  const por = (lista, chave) => {
    const m = new Map();
    for (const item of lista) {
      if (!m.has(item[chave])) m.set(item[chave], []);
      m.get(item[chave]).push(item);
    }
    return m;
  };
  const advAtivaPorMembro = new Map(advAtivas.map(a => [a.discord_id, a]));
  const advsPorMembro = por(advs, 'discord_id');
  const restr90PorId = por(restr90, 'id_fivem');
  const restrAtivasPorId = por(restrAtivas, 'id_fivem');
  const idsBloqueados = new Set(bloqueados.map(b => b.id_fivem));
  const bauPorId = new Map(bau.map(b => [b.id, b]));
  const bancoPorId = new Map(banco.map(b => [b.id, b]));

  return socios.map(socio => {
    const id = socio.idFivem;
    const ativa = advAtivaPorMembro.get(socio.discordId);
    const resumo = montarResumo({
      // O cargo ADV¹/²/³ é a fonte da verdade: ADV manual anterior ao registro em tabela só existe como cargo
      advAtivas: Math.max(ativa?.ativas ?? 0, nivelPorCargo(socio.membro)),
      nivelMax: Math.max(ativa?.nivel_max ?? 0, nivelPorCargo(socio.membro)), pagamentoPendente: ativa?.pagamento_pendente,
      advs: advsPorMembro.get(socio.discordId),
      restricoes90: id ? restr90PorId.get(id) : [],
      restricoesAtivas: id ? restrAtivasPorId.get(id) : [],
      h7Ms: id ? t7.get(id)?.ms : 0, h28Ms: id ? t28.get(id)?.ms : 0,
      ultimaAtividade: id ? ultimas.get(id) : null,
      naoRecrutar: id ? idsBloqueados.has(id) : false,
      bauEntrou: id ? bauPorId.get(id)?.entrou : 0, bauSaiu: id ? bauPorId.get(id)?.saiu : 0,
      bancoEntrou: id ? bancoPorId.get(id)?.entrou : 0, bancoSaiu: id ? bancoPorId.get(id)?.saiu : 0,
    }, agora);
    return { socio, ...resumo };
  });
}

async function atualizarResumos(client, opcoes = {}) {
  const resumos = await coletarResumos(client, opcoes);
  for (const r of resumos) {
    await repo.gravarResumo(r.socio.discordId, r.socio.idFivem, r.risco.score, r.dados);
  }
  return resumos;
}

module.exports = { montarResumo, coletarResumos, atualizarResumos };
