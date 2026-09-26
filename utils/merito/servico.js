// Mérito de recrutadores: orquestra o ciclo (abrir, medir, fechar, votar, encerrar,
// lembrar). Regras de pontos ficam em regras.js; SQL em repositorio.js; aqui só
// Discord, tempo e o encadeamento. Fechar e encerrar são idempotentes: o SQL só
// deixa o estado sair uma vez e só quem venceu a corrida anuncia.
const config = require('../../config/index.js');
const tema = require('../../tema');
const F = require('../logsJogo/painelFormato');
const { lerConfig, gravarConfig } = require('../botConfig');
const { agendar, registrarTipo } = require('../agendador');
const { jaAlertadoRecentemente } = require('../alertaPersistente');
const R = require('./regras');
const repo = require('./repositorio');
const { coletar } = require('./coleta');
const X = require('./extrato');
const P = require('./paineis');

const CHAVE_META = 'merito_meta_semanal';
const CHAVE_PISO = 'merito_piso_novatos';
const CHAVE_ANCORA = 'merito_ciclo_inicio';

// Regras editáveis pela liderança (botão → select → modal de 1 campo). Só valem para o
// PRÓXIMO ciclo: o ciclo aberto congela meta e piso na criação.
const REGRAS_EDITAVEIS = {
  [CHAVE_META]: { rotulo: 'META SEMANAL (RECRUTAMENTOS)', min: 1, max: 100, padrao: R.LIMITES.metaPadrao, campo: 'meta' },
  [CHAVE_PISO]: { rotulo: 'PISO DE NOVATOS POR SEMANA', min: 1, max: 500, padrao: R.LIMITES.pisoNovatosPadrao, campo: 'piso' },
};

async function lerRegrasAtuais() {
  const saida = {};
  for (const [chave, def] of Object.entries(REGRAS_EDITAVEIS)) {
    const n = Number(await lerConfig(chave));
    saida[def.campo] = Number.isInteger(n) && n >= def.min && n <= def.max ? n : def.padrao;
  }
  return saida;
}

async function definirRegra(chave, texto) {
  const def = REGRAS_EDITAVEIS[chave];
  if (!def) return { ok: false, mensagem: '⚠️ REGRA DESCONHECIDA.' };
  const n = Number(String(texto).trim());
  if (!Number.isInteger(n) || n < def.min || n > def.max) return { ok: false, mensagem: `⚠️ INFORME UM NÚMERO INTEIRO ENTRE ${def.min} E ${def.max}.` };
  await gravarConfig(chave, String(n));
  return { ok: true, valor: n, rotulo: def.rotulo };
}

// Meia-noite de Brasília (03:00 UTC): o ciclo começa no início de um dia
function inicioDoDia(data) {
  const d = new Date(new Date(data).getTime() - 3 * R.HORA_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 3, 0, 0));
}

// ── Ciclo ────────────────────────────────────────────────────────────────────

async function garantirCiclo(agora = new Date()) {
  const aberto = await repo.cicloAberto();
  if (aberto) return aberto;
  const ultimo = await repo.ultimoCiclo();
  let numero = 0;
  let inicio;
  if (!ultimo) {
    const ancora = await lerConfig(CHAVE_ANCORA);
    inicio = ancora ? new Date(ancora) : inicioDoDia(agora);
    if (!ancora) await gravarConfig(CHAVE_ANCORA, inicio.toISOString());
  } else {
    numero = ultimo.numero + 1;
    inicio = new Date(ultimo.fim);
  }
  const { fim } = R.datasDoCiclo(inicio);
  const ciclo = await repo.criarCiclo({
    numero, inicio, fim, sombra: numero === 0, versaoRegras: R.VERSAO_REGRAS, config: await lerRegrasAtuais(),
  });
  await agendar('merito_fechar', fim, { cicloId: ciclo.id }).catch(err => console.error('[merito] Erro ao agendar fechamento:', err.message));
  return ciclo;
}

async function fonteEmDia(agora) {
  const logs = require('../logsJogo/repositorio');
  const ultima = await logs.ultimaOcorrencia(['jogador_recrutou', 'jogador_entrou', 'jogador_saiu']);
  return Boolean(ultima) && (agora - new Date(ultima)) <= config.logsJogo.fonteParadaDias * R.DIA_MS;
}

// ── Cálculo e persistência ───────────────────────────────────────────────────

async function calcular(client, ciclo, { agora = new Date(), fontes = null } = {}) {
  const coleta = await coletar(client, ciclo, { agora, fontes });
  const linhas = coleta.recrutadores.map(d => {
    const res = R.pontuar(d);
    return { ...d, ...res, ...R.elegibilidade(d, res) };
  });
  return { coleta, ranking: R.ranquear(linhas) };
}

function detalheDe(l, meta) {
  const atual = l.semanas.find(s => s.emAndamento) ?? l.semanas.filter(s => !s.futura).pop() ?? l.semanas[0];
  return {
    nome: l.nome, idFivem: l.idFivem, meta,
    pontos: l.detalhe, semanasBatidas: l.semanasBatidas, semanasContaveis: l.semanasContaveis, maiorSequencia: l.maiorSequencia,
    efetivos: l.efetivos, totais: l.totais, manto: l.manto, fichas: l.fichas, engajamento: l.engajamento,
    advCiclo: l.advCiclo, advAtivaNivel: l.advAtivaNivel, risco: l.risco, cargoDesde: l.cargoDesde,
    semanaAtual: { indice: atual.indice, efetivos: atual.efetivos, meta: atual.meta, validos: atual.validos, pendentes: atual.pendentes },
  };
}

async function persistir(ciclo, ranking, meta, indicadosIds = new Set()) {
  for (const l of ranking) await repo.gravarSemanas(ciclo.id, l.discordId, l.semanas);
  await repo.gravarResultados(ciclo.id, ranking.map(l => ({
    discordId: l.discordId, pontos: l.pontos, bonus: l.bonus, posicao: l.posicao, elegivel: l.elegivel, motivos: l.motivos,
    indicado: indicadosIds.has(l.discordId), detalhe: detalheDe(l, meta),
  })));
}

// Fraude que retém vira pendência da liderança; o resto só avisa. Devolve as pendências NOVAS.
async function registrarPendencias(ciclo, fraudes) {
  const novas = [];
  for (const f of fraudes) {
    const criada = await repo.registrarRevisao({
      cicloId: ciclo.id, discordId: f.recrutador, tipo: f.tipo, chave: f.chave, semana: f.semana ?? null,
      detalhe: f.detalhe, status: f.retem ? 'PENDENTE' : 'INFORMATIVA',
    });
    if (criada && f.retem) novas.push(criada);
  }
  return novas;
}

const mencaoLideranca = () => config.lideranca.filter(Boolean).map(id => `<@&${id}>`).join(' ');

async function avisarLideranca(client, payload) {
  const canal = await P.canalDaVotacao(client);
  if (!canal) return null;
  return canal.send({ allowedMentions: { roles: config.lideranca.filter(Boolean) }, ...payload }).catch(err => {
    console.error('[merito] Erro ao avisar a liderança:', err.message);
    return null;
  });
}

// ── Lembretes (só ciclos valendo) ────────────────────────────────────────────

async function enviarLembretes(client, ciclo, coleta, agora) {
  if (ciclo.sombra) return;
  const guild = await client.guilds.fetch(config.guildId);
  const diaBrasilia = new Date(agora.getTime() - 3 * R.HORA_MS).getUTCDay();
  for (const d of coleta.recrutadores) {
    const semana = d.semanas.find(s => s.emAndamento && !s.foraDaConta && !s.dispensada);
    const ritmo = semana && R.ritmoDaSemana(semana, agora);
    const membro = guild.members.cache.get(d.discordId);
    if (!ritmo || !membro?.send) continue;
    const chave = `${ciclo.id}:${semana.indice}:${d.discordId}`;
    if (ritmo.bateu) {
      if (!(await jaAlertadoRecentemente('merito_bateu', chave, 6 * R.DIA_MS))) {
        await membro.send({ content: `${tema.emoji.ok} Você bateu a meta da semana (${ritmo.efetivos}/${ritmo.meta}). Constância é o que mais pesa no mérito.` }).catch(() => {});
      }
    } else if (diaBrasilia === R.LIMITES.lembreteDiaSemana) {
      if (!(await jaAlertadoRecentemente('merito_lembrete', chave, 6 * R.DIA_MS))) {
        await membro.send({ content: `${tema.emoji.pendente} Faltam **${ritmo.faltam}** recrutamento(s) para a meta da semana (${ritmo.efetivos}/${ritmo.meta}) e restam **${ritmo.diasRestantes}** dia(s). Veja o extrato em 🏆・mérito-recrutadores.` }).catch(() => {});
      }
    }
  }
}

// ── Varredura periódica ──────────────────────────────────────────────────────

async function atualizarParcial(client, { agora = new Date(), fontes = null, fonteEmDia: emDia = fonteEmDia } = {}) {
  let ciclo = await garantirCiclo(agora);
  for (let i = 0; i < 8 && R.cicloEncerrado(ciclo, agora); i++) {
    const fechado = await fecharCiclo(client, ciclo, { agora, fontes, fonteEmDia: emDia });
    if (!fechado) break;
    ciclo = await garantirCiclo(agora);
  }
  await encerrarVotacoesVencidas(client, { agora });
  if (R.cicloEncerrado(ciclo, agora)) return { ciclo, ranking: [], novas: [], adiado: true }; // fonte parada: não mede nem fecha

  const { coleta, ranking } = await calcular(client, ciclo, { agora, fontes });
  await persistir(ciclo, ranking, coleta.meta);
  const novas = await registrarPendencias(ciclo, coleta.fraudes);
  await enviarLembretes(client, ciclo, coleta, agora).catch(err => console.error('[merito] Erro nos lembretes:', err.message));
  if (novas.length) {
    await avisarLideranca(client, {
      content: `${mencaoLideranca()} ${tema.emoji.aviso} **${novas.length}** pendência(s) do mérito esperando decisão (recrutamentos retidos para revisão). Use **ANALISAR PENDÊNCIAS**.`,
    });
  }
  P.atualizarPaineis(client);
  return { ciclo, ranking, novas };
}

// ── Fechamento ───────────────────────────────────────────────────────────────

function resumoCalibracao(ranking) {
  const pontos = ranking.map(r => r.pontos + r.bonus).sort((a, b) => a - b);
  const mediana = R.mediana(pontos);
  const batidas = ranking.map(r => r.semanasBatidas);
  const qtd = n => batidas.filter(b => b >= n).length;
  return [
    `Recrutadores medidos: **${ranking.length}** · elegíveis: **${ranking.filter(r => r.elegivel).length}**`,
    `Pontos: mediana **${X.pts(mediana)}** · máximo **${X.pts(pontos[pontos.length - 1] ?? 0)}**`,
    `Bateram a meta em ${R.LIMITES.minSemanasBatidas}+ semanas: **${qtd(R.LIMITES.minSemanasBatidas)}** · em ${R.LIMITES.seloConstanteSemanas}+ semanas: **${qtd(R.LIMITES.seloConstanteSemanas)}**`,
    'Se poucos chegam ao mínimo, a meta está alta demais; se quase todos chegam, está baixa. Ajuste em **AJUSTAR REGRAS** (vale a partir do próximo ciclo).',
  ].join('\n');
}

async function anunciarFechamento(client, ciclo, ranking, indicados) {
  if (ciclo.sombra) {
    return avisarLideranca(client, {
      content: `${mencaoLideranca()} Ciclo **${ciclo.numero}** (calibração) encerrado. Nenhuma indicação foi feita.`,
      embeds: [{ color: F.COR, title: tema.titulo(`${tema.emoji.marca} CALIBRAÇÃO DO MÉRITO`), description: resumoCalibracao(ranking) }],
    });
  }
  if (!indicados.length) {
    return avisarLideranca(client, {
      content: `${mencaoLideranca()} Ciclo **${ciclo.numero}** encerrado sem nenhum recrutador elegível. Não há votação.`,
      embeds: [{ color: F.COR, title: tema.titulo(`${tema.emoji.marca} MÉRITO · CICLO ${ciclo.numero}`), description: resumoCalibracao(ranking) }],
    });
  }
  const resultados = (await repo.resultadosDoCiclo(ciclo.id)).filter(r => r.indicado);
  const selos = new Map();
  for (const r of resultados) selos.set(r.discord_id, await repo.selosDe(r.discord_id));
  return avisarLideranca(client, {
    content: `${mencaoLideranca()} ${tema.emoji.marca} Ciclo **${ciclo.numero}** do mérito fechado: **${indicados.length}** indicado(s) à diretoria do departamento. Votem até <t:${X.seg(ciclo.votacao_ate)}:F>.`,
    embeds: resultados.map(r => X.embedDossie({ resultado: r, posicao: r.posicao, selos: selos.get(r.discord_id) })),
  });
}

async function fecharCiclo(client, ciclo, { agora = new Date(), fontes = null, fonteEmDia: emDia = fonteEmDia } = {}) {
  if (!R.cicloEncerrado(ciclo, agora)) return null;
  const atual = await repo.buscarCiclo(ciclo.id);
  if (!atual || atual.status !== 'ABERTO') return null;
  if (!(await emDia(agora))) {
    if (!(await jaAlertadoRecentemente('merito_fonte_parada', String(atual.id), R.DIA_MS))) {
      await avisarLideranca(client, { content: `${tema.emoji.aviso} O ciclo **${atual.numero}** do mérito não pôde fechar: a fonte de logs do jogo está parada. Fecha sozinho quando os logs voltarem.` });
    }
    return null;
  }

  const { coleta, ranking } = await calcular(client, atual, { agora, fontes });
  await registrarPendencias(atual, coleta.fraudes);
  // Pendência que muda a pontuação (lote retido, pedido de dispensa) precisa de decisão ANTES de fechar:
  // depois do fechamento o ranking está congelado. Espera até a graça; passada ela, fecha como está.
  const abertas = await repo.revisoesPendentes(atual.id);
  if (abertas.length && agora < new Date(new Date(atual.fim).getTime() + R.LIMITES.gracaRevisaoDias * R.DIA_MS)) {
    if (!(await jaAlertadoRecentemente('merito_pendencias_fechamento', String(atual.id), R.DIA_MS))) {
      await avisarLideranca(client, {
        content: `${mencaoLideranca()} ${tema.emoji.aviso} O ciclo **${atual.numero}** do mérito terminou, mas tem **${abertas.length}** pendência(s) esperando decisão. Ele só fecha depois delas (no máximo em ${R.LIMITES.gracaRevisaoDias} dias). Use **ANALISAR PENDÊNCIAS**.`,
      });
    }
    return null;
  }
  const indicados = atual.sombra ? [] : R.selecionarIndicados(ranking);
  const ids = new Set(indicados.map(i => i.discordId));
  await persistir(atual, ranking, coleta.meta, ids);
  await repo.gravarSelos(atual.id, R.selosDoCiclo(ranking, indicados));

  const votacaoAte = indicados.length ? new Date(agora.getTime() + R.LIMITES.votacaoDias * R.DIA_MS) : null;
  const fechado = await repo.fecharCiclo(atual.id, { status: votacaoAte ? 'EM_VOTACAO' : 'FECHADO', votacaoAte });
  if (!fechado) return null; // outra instância venceu a corrida: quem perdeu não anuncia

  await garantirCiclo(agora); // abre o seguinte, começando onde este terminou
  if (votacaoAte) await agendar('merito_encerrar_votacao', votacaoAte, { cicloId: fechado.id }).catch(err => console.error('[merito] Erro ao agendar votação:', err.message));
  await anunciarFechamento(client, fechado, ranking, indicados);
  P.atualizarPaineis(client);
  return fechado;
}

// ── Votação ──────────────────────────────────────────────────────────────────

async function apuracaoDoCiclo(client, cicloId) {
  const guild = await client.guilds.fetch(config.guildId);
  const [resultados, votos, vetos, total] = await Promise.all([
    repo.resultadosDoCiclo(cicloId), repo.votosDoCiclo(cicloId), repo.vetosDoCiclo(cicloId), P.totalLideranca(guild),
  ]);
  const indicados = resultados.filter(r => r.indicado);
  return { indicados, apuracao: R.apurarVotacao({ indicados: indicados.map(r => r.discord_id), votos, vetos, total }), total };
}

const nomeDe = (indicados, id) => F.nomeSeguro(indicados.find(r => r.discord_id === id)?.detalhe?.nome ?? id);

async function anunciarResultado(client, ciclo, { indicados, apuracao, total }) {
  const placar = Object.entries(apuracao.contagem)
    .map(([id, n]) => `• **${nomeDe(indicados, id)}**: ${n} voto(s)${apuracao.vetados.includes(id) ? ' · VETADO' : ''}`).join('\n');
  const conclusao = !apuracao.quorumOk
    ? `${tema.emoji.aviso} **Sem quórum** (${apuracao.participacao} de ${total}; mínimo ${apuracao.quorum}). Decisão volta para a liderança.`
    : apuracao.recomendado
      ? `${tema.emoji.marca} Indicação da votação: **${nomeDe(indicados, apuracao.recomendado)}**. Registre a decisão em **REGISTRAR DECISÃO**.`
      : apuracao.empate
        ? `${tema.emoji.aviso} **Empate** entre ${apuracao.vencedores.map(id => nomeDe(indicados, id)).join(', ')}. A liderança desempata.`
        : `${tema.emoji.aviso} Nenhum indicado recebeu voto válido.`;
  return avisarLideranca(client, {
    content: `${mencaoLideranca()} Votação do mérito (ciclo ${ciclo.numero}) encerrada.`,
    embeds: [{ color: F.COR, title: tema.titulo(`${tema.emoji.marca} RESULTADO · CICLO ${ciclo.numero}`), description: `${placar}\n\n${conclusao}` }],
  });
}

// Chamado pela tarefa agendada e pela varredura (rede de segurança). Idempotente.
async function encerrarVotacao(client, cicloId, { agora = new Date() } = {}) {
  const ciclo = await repo.buscarCiclo(cicloId);
  if (!ciclo || ciclo.status !== 'EM_VOTACAO') return null;
  const dados = await apuracaoDoCiclo(client, cicloId);
  const situacao = R.situacaoDaVotacao({ agora, votacaoAte: ciclo.votacao_ate, prorrogada: ciclo.prorrogada, apuracao: dados.apuracao });
  if (situacao === 'aberta') return { situacao };
  if (situacao === 'prorrogar') {
    const novo = new Date(agora.getTime() + R.LIMITES.prorrogacaoDias * R.DIA_MS);
    const prorrogado = await repo.prorrogarVotacao(cicloId, novo);
    if (!prorrogado) return null;
    await agendar('merito_encerrar_votacao', novo, { cicloId }).catch(() => {});
    await avisarLideranca(client, {
      content: `${mencaoLideranca()} ${tema.emoji.aviso} Votação do mérito sem quórum (${dados.apuracao.participacao} de ${dados.total}; mínimo ${dados.apuracao.quorum}). Prorrogada até <t:${X.seg(novo)}:F>.`,
    });
    P.atualizarPaineis(client);
    return { situacao };
  }
  const concluido = await repo.concluirCiclo(cicloId);
  if (!concluido) return null;
  await anunciarResultado(client, concluido, dados);
  P.atualizarPaineis(client);
  return { situacao, ...dados };
}

async function encerrarVotacoesVencidas(client, { agora = new Date() } = {}) {
  const votacao = await repo.cicloEmVotacao();
  if (votacao && new Date(votacao.votacao_ate) <= agora) await encerrarVotacao(client, votacao.id, { agora });
}

// Voto da liderança. indicadoId '0'/null = abstenção. Só indicado do ciclo em votação.
async function registrarVoto(client, { cicloId, votanteId, indicadoId, agora = new Date() }) {
  const ciclo = await repo.buscarCiclo(cicloId);
  if (!ciclo || ciclo.status !== 'EM_VOTACAO' || new Date(ciclo.votacao_ate) <= agora) return { ok: false, mensagem: '⚠️ ESTA VOTAÇÃO JÁ FOI ENCERRADA.' };
  const abster = !indicadoId || indicadoId === '0';
  if (!abster) {
    const r = await repo.resultadoDe(cicloId, indicadoId);
    if (!r?.indicado) return { ok: false, mensagem: '⚠️ ESSE RECRUTADOR NÃO É INDICADO NESTE CICLO.' };
    if ((await repo.vetosDoCiclo(cicloId)).some(v => v.indicadoId === indicadoId)) return { ok: false, mensagem: '❌ ESSE INDICADO FOI VETADO PELA PRESIDÊNCIA.' };
  }
  await repo.votar(cicloId, votanteId, abster ? null : indicadoId);
  P.atualizarPaineis(client);
  return { ok: true, abster, ciclo };
}

async function registrarVeto(client, { cicloId, indicadoId, vetadoPor, motivo }) {
  const ciclo = await repo.buscarCiclo(cicloId);
  if (!ciclo || ciclo.status !== 'EM_VOTACAO') return { ok: false, mensagem: '⚠️ NÃO HÁ VOTAÇÃO ABERTA.' };
  const r = await repo.resultadoDe(cicloId, indicadoId);
  if (!r?.indicado) return { ok: false, mensagem: '⚠️ ESSE RECRUTADOR NÃO É INDICADO NESTE CICLO.' };
  const feito = await repo.vetar(cicloId, indicadoId, vetadoPor, motivo);
  if (!feito) return { ok: false, mensagem: '⚠️ ESSE INDICADO JÁ ESTÁ VETADO.' };
  P.atualizarPaineis(client);
  return { ok: true };
}

// ── Pendências: fraude e semana dispensada ───────────────────────────────────

async function pedirDispensa(client, { discordId, semana, motivo, agora = new Date() }) {
  const ciclo = await repo.cicloAberto();
  if (!ciclo) return { ok: false, mensagem: '⚠️ NÃO HÁ CICLO ABERTO.' };
  const semanas = R.datasDoCiclo(ciclo.inicio).semanas;
  const alvo = semanas[semana];
  if (!alvo || alvo.inicio > agora) return { ok: false, mensagem: '⚠️ ESCOLHA UMA SEMANA QUE JÁ COMEÇOU.' };
  const pedidos = await repo.pedidosDeDispensa(ciclo.id, discordId);
  if (pedidos.length >= R.LIMITES.semanasDispensadasPorCiclo) return { ok: false, mensagem: `⚠️ VOCÊ JÁ USOU AS ${R.LIMITES.semanasDispensadasPorCiclo} SEMANA(S) DISPENSADA(S) DESTE CICLO.` };
  const criado = await repo.registrarRevisao({ cicloId: ciclo.id, discordId, tipo: 'dispensa', chave: `semana:${semana}`, semana, detalhe: { motivo } });
  if (!criado) return { ok: false, mensagem: '⚠️ ESSE PEDIDO JÁ FOI FEITO.' };
  await avisarLideranca(client, {
    content: `${mencaoLideranca()} ${tema.emoji.pendente} <@${discordId}> pediu a **semana ${semana + 1}** dispensada: ${motivo}\nUse **ANALISAR PENDÊNCIAS**.`,
  });
  P.atualizarPaineis(client);
  return { ok: true, revisao: criado };
}

// Recálculo disparado por uma decisão: roda em segundo plano (a resposta ao clique não espera),
// mas dá para aguardar (testes e desligamento limpo).
let recalculo = Promise.resolve();
const aguardarRecalculo = () => recalculo;

// APROVADA/NEGADA. Fraude retida: aprovar = liberar a contagem; negar = descartar o lote.
async function decidirPendencia(client, { revisaoId, decisao, por }) {
  if (decisao !== 'APROVADA' && decisao !== 'NEGADA') return { ok: false, mensagem: '⚠️ DECISÃO INVÁLIDA.' };
  const revisao = await repo.decidirRevisao(revisaoId, decisao, por);
  if (!revisao) return { ok: false, mensagem: '⚠️ ESTA PENDÊNCIA JÁ FOI DECIDIDA (OU NÃO EXISTE).' };
  if (revisao.tipo === 'dispensa') {
    const guild = await client.guilds.fetch(config.guildId);
    const membro = guild.members.cache.get(revisao.discord_id);
    await membro?.send?.({ content: decisao === 'APROVADA'
      ? `${tema.emoji.ok} Sua semana ${(revisao.semana ?? 0) + 1} foi dispensada: ela sai da conta do mérito.`
      : `${tema.emoji.recusado} Seu pedido de dispensa da semana ${(revisao.semana ?? 0) + 1} foi negado.` }).catch(() => {});
  }
  recalculo = atualizarParcial(client).catch(err => console.error('[merito] Erro ao recalcular depois da decisão:', err.message));
  return { ok: true, revisao };
}

async function registrarDecisaoFinal(client, { cicloId, discordId, decisao, por }) {
  const ciclo = await repo.buscarCiclo(cicloId);
  if (!ciclo || ciclo.status !== 'CONCLUIDO') return { ok: false, mensagem: '⚠️ A VOTAÇÃO DESTE CICLO AINDA NÃO FOI ENCERRADA.' };
  const feito = await repo.registrarDecisao(cicloId, discordId, decisao, por);
  if (!feito) return { ok: false, mensagem: '⚠️ ESSE RECRUTADOR NÃO É INDICADO NESTE CICLO.' };
  P.atualizarPaineis(client);
  return { ok: true };
}

// ── Tarefas agendadas e início ───────────────────────────────────────────────

registrarTipo('merito_fechar', async (client, payload) => {
  const ciclo = await repo.buscarCiclo(payload.cicloId);
  if (ciclo) await fecharCiclo(client, ciclo);
});
registrarTipo('merito_encerrar_votacao', async (client, payload) => {
  await encerrarVotacao(client, payload.cicloId);
});

const INTERVALO_MS = 60 * 60 * 1000;
const ATRASO_INICIAL_MS = 3 * 60 * 1000;

function iniciar(client) {
  const rodar = () => atualizarParcial(client).catch(err => console.error('[merito] Erro na varredura:', err));
  setTimeout(rodar, ATRASO_INICIAL_MS);
  setInterval(rodar, INTERVALO_MS);
}

module.exports = {
  REGRAS_EDITAVEIS, CHAVE_META, CHAVE_PISO, CHAVE_ANCORA,
  lerRegrasAtuais, definirRegra, garantirCiclo, calcular, persistir, registrarPendencias,
  atualizarParcial, fecharCiclo, encerrarVotacao, encerrarVotacoesVencidas, apuracaoDoCiclo,
  registrarVoto, registrarVeto, pedirDispensa, decidirPendencia, registrarDecisaoFinal,
  enviarLembretes, resumoCalibracao, inicioDoDia, aguardarRecalculo, iniciar,
};
