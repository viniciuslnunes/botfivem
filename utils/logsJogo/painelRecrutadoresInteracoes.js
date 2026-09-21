const {
  ActionRowBuilder, StringSelectMenuBuilder, UserSelectMenuBuilder, escapeMarkdown,
} = require('discord.js');
const config = require('../../config/index.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const { garantirMembrosCarregados } = require('../membrosGuild');
const E = require('./estatisticas');
const F = require('./painelFormato');
const P = require('./presenca');
const repo = require('./repositorio');
const relatorios = require('./relatorios');

// Canal 🦅・painel-recrutadores: cruza o cargo RECRUTADOR (Discord) com o que
// o jogo logou de verdade (jogador_recrutou, ator = recrutador) e com o tempo
// jogado no período — pra liderança ver quem tá de fato trabalhando, não só
// quem tem o cargo. Ver docs/padroes-e-canais.md § 1.1 (card fixo +
// exploração ephemeral) e § 1.4 (correlação Discord↔jogo pelo ID no apelido).
const ACOES_RECRUTAMENTO = ['jogador_recrutou'];
const LIMITE_SESSAO_MS = config.logsJogo.presencaSessaoMaxHoras * 60 * 60 * 1000;
// Recrutado que sai/é expulso/some por inatividade dentro dessa janela conta
// como "recrutamento que não colou" na taxa de retenção — separa quantidade
// de qualidade (ver config.logsJogo.retencaoRecrutamentoDias).
const JANELA_RETENCAO_MS = config.logsJogo.retencaoRecrutamentoDias * 24 * 60 * 60 * 1000;
const PERIODO_PADRAO = '30d';

// Mesmos períodos de PERIODOS_FICHA (relatorios.js, não exportado) — usados
// na ficha de um recrutador buscado direto, pra cruzar com
// montarFichaCompletaJogador (que já devolve `ms` nestas mesmas chaves).
const PERIODOS_FICHA_RECRUTADOR = ['7d', '30d', 'ontem', 'semana_passada', 'mes_passado'];

const PERIODOS_RECRUTADORES = [
  { chave: 'hoje', label: 'HOJE' },
  { chave: 'ontem', label: 'ONTEM' },
  { chave: '7d', label: 'ÚLTIMOS 7 DIAS' },
  { chave: '30d', label: 'ÚLTIMOS 30 DIAS' },
  { chave: '90d', label: 'ÚLTIMOS 90 DIAS' },
];

function selectPeriodo() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('recrutadores:selperiodo')
    .setPlaceholder('ESCOLHA UM PERÍODO')
    .addOptions(PERIODOS_RECRUTADORES.map(p => ({ label: p.label, value: p.chave })));
  return new ActionRowBuilder().addComponents(select);
}

// Select nativo do Discord (mesmo tipo de presencaInteracoes#selectBuscarJogador)
// pra abrir a ficha cross-período de um recrutador específico direto, sem
// escolher período antes.
function selectBuscarRecrutador() {
  const select = new UserSelectMenuBuilder()
    .setCustomId('recrutadores:buscarrecrutador')
    .setPlaceholder('🔎 BUSCAR RECRUTADOR (DISCORD)');
  return new ActionRowBuilder().addComponents(select);
}

function linhaComponentesRecrutadores() {
  return [selectPeriodo(), selectBuscarRecrutador()];
}

function celulaTempo(ms) {
  return ms > 0 ? E.formatarDuracao(ms) : '—';
}

function celulaRatio(recrutamentos, ms) {
  if (ms > 0) return (recrutamentos / (ms / 3600000)).toFixed(2);
  return recrutamentos > 0 ? '∞' : '—';
}

function celulaStatus(l) {
  if (!l.idFivem) return '❔';
  return l.online ? '🟢' : '⚪';
}

// % de quem foi recrutado por essa pessoa e NÃO saiu/foi expulso/removido
// por inatividade dentro de JANELA_RETENCAO_MS — separa quantidade
// (RECRUT.) de qualidade: recrutador que infla número com gente que não
// fica tem RECRUT. alto e RET. baixo.
function celulaRetencao(recrutamentos, saiuCedo) {
  if (!recrutamentos) return '—';
  return `${Math.round(((recrutamentos - saiuCedo) / recrutamentos) * 100)}%`;
}

function tabelaRecrutadores(linhas) {
  return F.tabela([
    { titulo: '#', valor: (l, i) => String(i + 1), alinhar: 'dir' },
    { titulo: 'RECRUTADOR', valor: l => l.nome, alinhar: 'esq', larguraMax: 18 },
    { titulo: 'RECRUT.', valor: l => E.formatarNumero(l.recrutamentos), alinhar: 'dir' },
    { titulo: 'RET.', valor: l => celulaRetencao(l.recrutamentos, l.saiuCedo), alinhar: 'dir' },
    { titulo: 'TEMPO', valor: l => celulaTempo(l.ms), alinhar: 'dir' },
    { titulo: 'REC/H', valor: l => celulaRatio(l.recrutamentos, l.ms), alinhar: 'dir' },
    { titulo: 'ST', valor: l => celulaStatus(l), alinhar: 'esq' },
  ], linhas);
}

// Cruza cargo RECRUTADOR + recrutamentos (logs_jogo, ator) + tempo jogado no
// período (presenca.js) + status online agora — um array por pessoa,
// ordenado por quem mais recrutou (empate: mais tempo jogado). Recrutador
// sem ID do jogo no apelido (`E.idFivemDoNick`) entra zerado, não some da
// lista: é exatamente quem precisa vincular o ID pra a liderança enxergar.
async function recrutadoresDoPeriodo(guild, periodo, agora = new Date()) {
  await garantirMembrosCarregados(guild);
  const membros = [...guild.members.cache.filter(m => m.roles.cache.has(config.cargos.recrutador)).values()];
  const comId = membros.map(m => ({
    discordId: m.id,
    nome: m.displayName,
    idFivem: E.idFivemDoNick(m.nickname ?? m.displayName),
  }));
  const idsFivem = [...new Set(comId.filter(m => m.idFivem).map(m => m.idFivem))];

  const [contagens, tempoPorId, estadoAgora, recrutamentosDetalhe] = await Promise.all([
    repo.contarPorAtorNaLista(ACOES_RECRUTAMENTO, idsFivem, periodo),
    relatorios.tempoJogadoPorId(periodo),
    repo.estadoDosJogadores(agora),
    repo.recrutamentosDetalhados(idsFivem, periodo),
  ]);
  const mapaContagem = new Map(contagens.map(c => [c.id, c.total]));
  const idsOnline = new Set(P.listaOnline(P.estadoSemSessoesExpiradas(estadoAgora, LIMITE_SESSAO_MS, agora)).map(e => e.id));

  // Retenção: pra cada recrutamento do período, checa se o alvo saiu/foi
  // expulso/removido dentro da janela — não filtra a saída por período (ver
  // repo.primeiraSaidaPorAlvo), então um recrutamento do fim do período que
  // "ainda vai dar errado" só aparece quando esse tempo já tiver passado.
  const idsAlvo = [...new Set(recrutamentosDetalhe.map(r => r.recrutado))];
  const saidas = await repo.primeiraSaidaPorAlvo(idsAlvo, relatorios.ACOES_CHURN);
  const saidaPorId = new Map(saidas.map(s => [s.id, s.saida_em]));
  const saiuCedoPorRecrutador = new Map();
  for (const r of recrutamentosDetalhe) {
    const saidaEm = saidaPorId.get(r.recrutado);
    if (saidaEm && new Date(saidaEm).getTime() - new Date(r.ocorrido_em).getTime() <= JANELA_RETENCAO_MS) {
      saiuCedoPorRecrutador.set(r.recrutador, (saiuCedoPorRecrutador.get(r.recrutador) ?? 0) + 1);
    }
  }

  const linhas = comId.map(m => {
    const recrutamentos = m.idFivem ? (mapaContagem.get(m.idFivem) ?? 0) : 0;
    const ms = m.idFivem ? (tempoPorId.get(m.idFivem)?.ms ?? 0) : 0;
    const saiuCedo = m.idFivem ? (saiuCedoPorRecrutador.get(m.idFivem) ?? 0) : 0;
    return { ...m, recrutamentos, ms, saiuCedo, online: m.idFivem ? idsOnline.has(m.idFivem) : false };
  });
  linhas.sort((a, b) => b.recrutamentos - a.recrutamentos || b.ms - a.ms);
  return linhas;
}

function embedRankingRecrutadores(linhas, periodo) {
  const zerados = linhas.filter(l => l.recrutamentos === 0).length;
  const baixaRetencao = linhas.filter(l => l.recrutamentos >= 3 && (l.recrutamentos - l.saiuCedo) / l.recrutamentos < 0.5).length;
  return {
    color: F.COR,
    title: `🏆 RECRUTADORES — ${periodo.rotulo}`,
    description: [
      `**RECRUTADORES:** ${E.formatarNumero(linhas.length)}`,
      zerados ? `⚠️ **${E.formatarNumero(zerados)}** sem nenhum recrutamento no período.` : null,
      baixaRetencao ? `⚠️ **${E.formatarNumero(baixaRetencao)}** com retenção abaixo de 50% (mín. 3 recrutamentos).` : null,
      '',
      linhas.length ? tabelaRecrutadores(linhas) : '*Nenhum membro com o cargo RECRUTADOR.*',
    ].filter(Boolean).join('\n'),
    footer: { text: F.rodape('canal logs-registros + logs-painel') },
    timestamp: new Date().toISOString(),
  };
}

// Filtra `eventos` (jogador_recrutou de UM ator, já com alvo_id_fivem) pra
// uma janela e conta quantos alvos saíram cedo — mesma regra de
// recrutadoresDoPeriodo, só que a partir de uma lista já em memória (a ficha
// varre 5 períodos sobrepostos sem repetir a query de recrutamentos a cada um).
function contarComRetencao(eventos, saidaPorId, inicioMs, fimMs) {
  const doPeriodo = eventos.filter(e => {
    const t = new Date(e.ocorrido_em).getTime();
    return t >= inicioMs && t < fimMs;
  });
  const saiuCedo = doPeriodo.filter(e => {
    const saidaEm = saidaPorId.get(e.alvo_id_fivem);
    return saidaEm && new Date(saidaEm).getTime() - new Date(e.ocorrido_em).getTime() <= JANELA_RETENCAO_MS;
  }).length;
  return { total: doPeriodo.length, saiuCedo };
}

function embedFichaRecrutador(membro, ficha, porPeriodo) {
  const linhas = [`**ID do jogo:** \`${ficha.idFivem}\``];
  linhas.push(ficha.sessaoAtual
    ? `**AGORA:** online desde <t:${Math.floor(new Date(ficha.sessaoAtual.desde).getTime() / 1000)}:R> — ${E.formatarDuracao(ficha.sessaoAtual.ms)}`
    : '**AGORA:** offline');
  for (const p of ficha.porPeriodo) {
    const { total, saiuCedo } = porPeriodo.get(p.chave) ?? { total: 0, saiuCedo: 0 };
    linhas.push(`**${p.rotulo}:** ${celulaTempo(p.ms)} jogado · ${E.formatarNumero(total)} recrutamento(s) · ${celulaRatio(total, p.ms)}/h · retenção ${celulaRetencao(total, saiuCedo)}`);
  }
  return {
    color: F.COR,
    title: `🦅 ${escapeMarkdown(membro.displayName ?? ficha.nome ?? '?')}`,
    description: linhas.join('\n'),
    footer: { text: F.rodape('canal logs-registros + logs-painel') },
    timestamp: new Date().toISOString(),
  };
}

// Devolve o painel fixo (não a resposta ephemeral) pro estado limpo depois de
// escolher um período ou buscar um recrutador — mesmo motivo de
// presencaInteracoes#resetarPainelFixo (senão a opção escolhida fica "presa"
// visualmente no componente). Requerido aqui dentro (não no topo) pra evitar
// ciclo de require com painelRecrutadores.js, que importa este módulo.
function resetarPainelFixo(client) {
  const { agendarAtualizacaoReativa } = require('./painelRecrutadores');
  agendarAtualizacaoReativa(client);
}

registrarModulo('recrutadores', async interaction => {
  const [, acao] = interaction.customId.split(':');

  if (interaction.isStringSelectMenu() && acao === 'selperiodo') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    const periodo = E.resolverPeriodo(interaction.values[0]);
    const linhas = await recrutadoresDoPeriodo(interaction.guild, periodo);
    await interaction.editReply({ embeds: [embedRankingRecrutadores(linhas, periodo)], allowedMentions: { parse: [] } });
    resetarPainelFixo(interaction.client);
    return;
  }

  if (interaction.isUserSelectMenu() && acao === 'buscarrecrutador') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const membro = interaction.members.first();
    if (!membro?.roles.cache.has(config.cargos.recrutador)) {
      resetarPainelFixo(interaction.client);
      return interaction.reply({
        content: `❌ ${membro ?? 'ESSE MEMBRO'} NÃO TEM O CARGO RECRUTADOR.`,
        flags: 64,
        allowedMentions: { parse: [] },
      });
    }
    const idFivem = E.idFivemDoNick(membro.nickname ?? membro.displayName);
    if (!idFivem) {
      resetarPainelFixo(interaction.client);
      return interaction.reply({
        content: `❌ ${membro} NÃO TEM ID DO JOGO NO APELIDO (PADRÃO "... - 1234").`,
        flags: 64,
        allowedMentions: { parse: [] },
      });
    }
    await interaction.deferReply({ flags: 64 });
    const [ficha, eventos] = await Promise.all([
      relatorios.montarFichaCompletaJogador(idFivem),
      repo.eventosDoAtor(idFivem, ACOES_RECRUTAMENTO, 500),
    ]);
    const idsAlvo = [...new Set(eventos.map(e => e.alvo_id_fivem).filter(Boolean))];
    const saidas = await repo.primeiraSaidaPorAlvo(idsAlvo, relatorios.ACOES_CHURN);
    const saidaPorId = new Map(saidas.map(s => [s.id, s.saida_em]));
    const porPeriodo = new Map(PERIODOS_FICHA_RECRUTADOR.map(chave => {
      const periodo = E.resolverPeriodo(chave);
      const inicioMs = periodo.inicio ? new Date(periodo.inicio).getTime() : 0;
      const fimMs = new Date(periodo.fim).getTime();
      return [chave, contarComRetencao(eventos, saidaPorId, inicioMs, fimMs)];
    }));
    await interaction.editReply({ embeds: [embedFichaRecrutador(membro, ficha, porPeriodo)] });
    resetarPainelFixo(interaction.client);
    return;
  }
});

module.exports = {
  linhaComponentesRecrutadores,
  recrutadoresDoPeriodo,
  tabelaRecrutadores,
  ACOES_RECRUTAMENTO,
  PERIODO_PADRAO,
};
