// Mérito de recrutadores: coleta os dados brutos de um ciclo (logs do jogo, fichas,
// manto, advertências, presença, risco) e entrega, por recrutador, o que o motor
// de regras precisa. Nenhuma regra de pontos aqui.
const config = require('../../config/index.js');
const { garantirMembrosCarregados } = require('../membrosGuild');
const { idFivemDoNick } = require('../logsJogo/estatisticas');
const R = require('./regras');
const repo = require('./repositorio');

const DIA = R.DIA_MS;

// Consulta de módulo opcional (eventos, inteligência…): falhou = dado neutro, o mérito segue
async function opcional(fn, padrao) {
  try { return await fn(); } catch (err) {
    console.error('[merito] Dado opcional indisponível:', err.message);
    return padrao;
  }
}

function nivelDoCargoAdv(membro) {
  const cargos = config.cargos.advRec;
  if (!Array.isArray(cargos) || cargos.length !== 3 || !cargos.every(Boolean)) return 0;
  const i = cargos.findIndex(id => membro.roles.cache.has(id));
  return i === -1 ? 0 : i + 1;
}

async function recrutadoresDoServidor(guild) {
  await garantirMembrosCarregados(guild);
  return [...guild.members.cache.filter(m => m.roles.cache.has(config.cargos.recrutador)).values()].map(m => ({
    membro: m, discordId: m.id, nome: m.displayName, idFivem: idFivemDoNick(m.nickname ?? m.displayName),
  }));
}

// config do ciclo: { meta, piso } congelados na abertura
async function coletar(client, ciclo, { agora = new Date(), fontes = null } = {}) {
  const guild = await client.guilds.fetch(config.guildId);
  const todos = await recrutadoresDoServidor(guild);
  const semId = todos.filter(r => !r.idFivem);
  const medidos = todos.filter(r => r.idFivem);
  const idsFivem = [...new Set(medidos.map(r => r.idFivem))];
  const discordPorFivem = new Map(medidos.map(r => [r.idFivem, r.discordId]));
  const nomePorDiscord = new Map(medidos.map(r => [r.discordId, r.nome]));
  const { inicio, fim } = R.datasDoCiclo(ciclo.inicio);
  const cfg = ciclo.config ?? {};
  const meta = cfg.meta ?? R.LIMITES.metaPadrao;
  const piso = cfg.piso ?? R.LIMITES.pisoNovatosPadrao;

  const logs = require('../logsJogo/repositorio');
  const { ACOES_PROBLEMA, JANELA_PROBLEMA_DIAS } = require('../logsJogo/inteligenciaRecrutadores');
  const { ACOES_CHURN } = require('../logsJogo/relatorios');
  const advRepo = require('../advertenciaRecrutadorAuto/repositorio');

  const rows = fontes?.recrutamentos ?? await repo.recrutamentosDoCiclo(idsFivem, inicio, fim);
  const pares = rows.map(r => ({ recrutador: r.recrutador, alvo: r.recrutado, em: r.ocorridoEm }));
  const alvos = [...new Set(rows.map(r => r.recrutado))];

  const [fantasmas, problemas, saidas, aprovados, bloqueados, novatos, mantos, fichas, eventos, decisoes, dispensas, cargoDesde, anteriorRes, ativas] = await Promise.all([
    fontes?.fantasmas ?? logs.recrutadosSemAtividadeDepois(pares),
    fontes?.problemas ?? logs.recrutadosComOcorrenciaDepois(pares, ACOES_PROBLEMA, JANELA_PROBLEMA_DIAS),
    fontes?.saidas ?? logs.primeiraSaidaPorAlvo(alvos, ACOES_CHURN),
    fontes?.aprovados ?? repo.idsAprovadosComFicha(alvos),
    opcional(async () => (await require('../naoRecrutarEspelho').ativos()), []),
    opcional(() => require('../recrutamento/funilRepositorio').novatosDoPeriodo(inicio, fim), []),
    repo.mantosDoCiclo(inicio, fim),
    repo.fichasDoCiclo(inicio, fim),
    opcional(() => require('../inteligencia/repositorio').eventosComPresenca(Math.ceil((agora - inicio) / DIA) + 1, 200), []),
    repo.decisoesDeFraude(ciclo.id),
    repo.dispensasAprovadas(ciclo.id),
    advRepo.cargoDesdeComPromocao(medidos.map(r => ({ discordId: r.discordId, idFivem: r.idFivem }))),
    opcional(async () => {
      const anterior = await repo.cicloAnteriorA(ciclo.numero);
      return anterior ? { ciclo: anterior, linhas: await repo.resultadosDoCiclo(anterior.id) } : null;
    }, null),
    advRepo.ativas(),
  ]);

  const chaveFantasma = new Set(fantasmas.map(f => `${f.recrutador}|${f.alvo}`));
  const chaveProblema = new Set(problemas.map(p => `${p.recrutador}|${p.alvo}`));
  const saidaPorId = new Map(saidas.map(s => [s.id, s.saida_em]));
  const janelaRetencao = config.logsJogo.retencaoRecrutamentoDias * DIA;
  const bloqueioPorId = new Map(bloqueados.map(b => [b.id_fivem, b.bloqueado_em]));
  const aprovadoSet = aprovados instanceof Set ? aprovados : new Set(aprovados);

  const brutos = rows.map(r => {
    const saida = saidaPorId.get(r.recrutado);
    return {
      recrutador: discordPorFivem.get(r.recrutador), recrutado: r.recrutado, ocorridoEm: r.ocorridoEm,
      recrutadoNome: r.recrutadoNome, recrutadorNome: nomePorDiscord.get(discordPorFivem.get(r.recrutador)),
      fantasma: chaveFantasma.has(`${r.recrutador}|${r.recrutado}`),
      problema: chaveProblema.has(`${r.recrutador}|${r.recrutado}`),
      saiuCedo: Boolean(saida) && new Date(saida) - new Date(r.ocorridoEm) <= janelaRetencao,
      aprovado: aprovadoSet.has(r.recrutado),
      bloqueadoEm: bloqueioPorId.get(r.recrutado) ?? null,
    };
  }).filter(b => b.recrutador);

  const { itens, fraudes } = R.prepararRecrutamentos(brutos, { agora, decisoes });

  const haNovatos = novatos.length > 0;
  const novatosPorSemana = haNovatos
    ? Array.from({ length: R.LIMITES.semanasCiclo }, (_, i) => novatos.filter(n => R.semanaDe(ciclo, n.ocorrido_em) === i).length)
    : null;

  const eventosDoCiclo = eventos.filter(e => new Date(e.inicio_em) >= inicio && new Date(e.inicio_em) < fim);
  const advPorId = new Map();
  for (const a of ativas) advPorId.set(a.discord_id, Math.max(advPorId.get(a.discord_id) ?? 0, a.nivel));
  const anteriorPorId = new Map((anteriorRes?.linhas ?? []).map(l => [l.discord_id, l]));

  const recrutadores = [];
  for (const r of medidos) {
    const meus = itens.filter(i => i.recrutador === r.discordId);
    const semanas = R.agregarSemanas(meus, {
      ciclo, meta, piso, novatosPorSemana, dispensadas: dispensas.get(r.discordId) ?? new Set(),
      cargoDesde: cargoDesde.get(r.discordId) ?? null, agora,
    });
    const maduros = meus.filter(i => (i.estado === 'valido' || i.estado === 'invalido')
      && agora - new Date(i.ocorridoEm) >= R.LIMITES.janelaValidacaoDias * DIA);
    const historico = await opcional(() => advRepo.historicoDoMembro(r.discordId), []);
    const advDoCiclo = historico.filter(a => a.nivel > 0 && new Date(a.criada_em) >= inicio && new Date(a.criada_em) < fim).length;
    const manualNivel = nivelDoCargoAdv(r.membro);
    const anterior = anteriorPorId.get(r.discordId);
    const risco = await opcional(async () => (await require('../inteligencia/repositorio').resumoDe(r.discordId))?.risco ?? 0, 0);
    const presentes = eventosDoCiclo.filter(e => (e.presentes ?? []).includes(r.discordId)).length;

    recrutadores.push({
      discordId: r.discordId, nome: r.nome, idFivem: r.idFivem, agora,
      cargoDesde: cargoDesde.get(r.discordId) ?? null,
      semanas,
      efetivos: semanas.reduce((s, x) => s + x.efetivos, 0),
      totais: {
        brutos: meus.length,
        maduros: maduros.length,
        ficaram: maduros.filter(i => i.estado === 'valido').length,
        aprovados: maduros.filter(i => i.aprovado).length,
      },
      manto: mantos.get(r.discordId) ?? { avaliados: 0, corretos: 0 },
      fichas: fichas.get(r.discordId) ?? { aprovadas: 0, completas: 0 },
      engajamento: { eventos: eventosDoCiclo.length, presentes },
      advCiclo: Math.max(advDoCiclo, advDoCiclo === 0 && manualNivel > 0 ? 1 : 0),
      advAtivaNivel: Math.max(advPorId.get(r.discordId) ?? 0, manualNivel),
      risco,
      emRevisao: meus.some(i => i.estado === 'retido'),
      anterior: anterior ? { pontos: Number(anterior.pontos), posicao: anterior.posicao, teveAdv: (anterior.detalhe?.pontos?.disciplina ?? 0) < 0 } : null,
    });
  }

  const picosFraude = recrutadores.flatMap(d => R.picos(d.semanas).map(p => ({
    tipo: 'pico', chave: `pico:${p.semana}`, recrutador: d.discordId, retem: false, semana: p.semana,
    detalhe: { efetivos: p.efetivos, mediana: p.mediana },
  })));

  return { recrutadores, semId, fraudes: [...fraudes, ...picosFraude], meta, piso, itens };
}

module.exports = { coletar, recrutadoresDoServidor };
