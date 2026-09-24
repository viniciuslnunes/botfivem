const {
  ActionRowBuilder, StringSelectMenuBuilder, UserSelectMenuBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, escapeMarkdown,
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
const I = require('./inteligenciaRecrutadores');

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

// Meta semanal de recrutamentos (mesma para todos, editável pela liderança):
// campo único, então vai direto do botão ao modal, sem select de campo.
function linhaMeta() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('recrutadores:meta').setLabel('META SEMANAL').setEmoji('🎯').setStyle(ButtonStyle.Secondary)
  );
}

function modalMeta(atual) {
  return new ModalBuilder()
    .setCustomId('recrutadores:metamodal')
    .setTitle('META SEMANAL DE RECRUTAMENTOS')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('valor')
        .setLabel('RECRUTAMENTOS POR SEMANA (0 = SEM META)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(atual))
        .setRequired(true)
        .setMaxLength(3)
    ));
}

function linhaComponentesRecrutadores() {
  return [selectPeriodo(), selectBuscarRecrutador(), linhaMeta()];
}

function celulaTempo(ms) {
  return ms > 0 ? E.formatarDuracao(ms) : '—';
}

function celulaRatio(recrutamentos, ms) {
  if (ms > 0) return (recrutamentos / (ms / 3600000)).toFixed(2);
  return recrutamentos > 0 ? '∞' : '—';
}

// % de quem foi recrutado por essa pessoa e NÃO saiu/foi expulso/removido
// por inatividade dentro de JANELA_RETENCAO_MS — separa quantidade
// (RECRUT.) de qualidade: recrutador que infla número com gente que não
// fica tem RECRUT. alto e RET. baixo.
function celulaRetencao(recrutamentos, saiuCedo) {
  if (!recrutamentos) return '—';
  return `${Math.round(((recrutamentos - saiuCedo) / recrutamentos) * 100)}%`;
}

// Apelido do servidor vem como "R GDF | Nome - 1234": o prefixo (patente/sigla)
// e o ID do jogo comem a largura da coluna e deixam o nome cortado. Na tabela
// fica só o nome; o ID continua na ficha.
function nomeCurto(nome) {
  const semPrefixo = String(nome ?? '').replace(/^[^|]{1,12}\|\s*/, '');
  const semId = semPrefixo.replace(/\s*[-–]\s*\d+\s*$/, '').trim();
  return semId || String(nome ?? '?');
}

// Uma linha por recrutador, com títulos completos e o ID do jogo em coluna
// própria. O bloco de código do embed comporta ~56 caracteres no desktop
// (a linha antiga, com 58, quebrava): colunas separadas por 1 espaço e o
// online vira "●" colado ao nome (emoji quebraria o alinhamento).
const MAX_LINHAS_TABELA = 40;
const LARGURA_NOME = 16; // inclui a marca de online

const colunaNome = { titulo: 'RECRUTADOR', valor: l => `${l.online ? '●' : ' '}${nomeCurto(l.nome)}`, alinhar: 'esq', larguraMax: LARGURA_NOME };

// Tabela + aviso do que ficou de fora (`max` linhas visíveis).
function tabelaCortada(colunas, linhas, max) {
  const visiveis = linhas.slice(0, max);
  const tabela = F.tabela(colunas, visiveis, { separador: ' ' });
  const resto = linhas.length - visiveis.length;
  return resto > 0 ? `${tabela}\n*+${E.formatarNumero(resto)} recrutador(es) abaixo, ocultos.*` : tabela;
}

function tabelaRecrutadores(linhas, max = MAX_LINHAS_TABELA) {
  return tabelaCortada([
    { titulo: '#', valor: (l, i) => String(i + 1), alinhar: 'dir' },
    colunaNome,
    { titulo: 'ID', valor: l => l.idFivem ?? '—', alinhar: 'dir' },
    { titulo: 'RECRUT.', valor: l => E.formatarNumero(l.recrutamentos), alinhar: 'dir' },
    { titulo: 'RETENÇÃO', valor: l => celulaRetencao(l.recrutamentos, l.saiuCedo), alinhar: 'dir' },
    { titulo: 'TEMPO', valor: l => celulaTempo(l.ms), alinhar: 'dir' },
    { titulo: 'REC/H', valor: l => celulaRatio(l.recrutamentos, l.ms), alinhar: 'dir' },
  ], linhas, max);
}

const LEGENDA_TABELA = '-# ● online agora · RECRUT. = recrutamentos · RETENÇÃO = % que não saiu cedo · REC/H = recrutamentos por hora jogada';
const temCampo = (linhas, campo) => linhas.some(l => l[campo] !== undefined);

// Legendas só falam das colunas que existem (ADV, MANTO e FICHAS dependem do
// módulo de advertência automática).
const legendaControle = linhas => `-# RECRUTOU = há quanto tempo fez o último recrutamento · ONLINE = última vez no jogo · TENDÊNCIA = contra o período anterior · META = recrutamentos nos últimos 7 dias ÷ meta semanal${temCampo(linhas, 'advNivel') ? ' · ADV = advertência ativa (novo = em carência)' : ''}`;
const legendaQualidade = linhas => `-# PROBLEMAS = recrutados com advertência, blacklist ou impedimento em até ${I.JANELA_PROBLEMA_DIAS} dias · FANTASMAS = recrutados há ${I.FANTASMA_DIAS}+ dias que nunca mais apareceram no jogo${temCampo(linhas, 'erros7') ? ' · MANTO / FICHAS = mantos errados e fichas aprovadas incompletas nos últimos 7 dias' : ''}`;

// CONTROLE: atividade recente, tendência, meta e situação disciplinar. ADV só
// existe quando o módulo de advertência automática está ligado.
function tabelaControle(linhas, max = MAX_LINHAS_TABELA, agora = new Date()) {
  const colunas = [
    colunaNome,
    { titulo: 'RECRUTOU', valor: l => (l.idFivem ? I.tempoDesde(l.ultimoRecrutou, agora) : '—'), alinhar: 'dir' },
    { titulo: 'ONLINE', valor: l => I.celulaOnline(l, agora), alinhar: 'dir' },
    { titulo: 'TENDÊNCIA', valor: l => (l.idFivem ? I.celulaTendencia(l.recrutamentos, l.anterior) : '—'), alinhar: 'dir' },
    { titulo: 'META', valor: l => (l.idFivem ? I.celulaMeta(l.rec7, l.meta) : '—'), alinhar: 'dir' },
  ];
  if (temCampo(linhas, 'advNivel')) colunas.push({ titulo: 'ADV', valor: l => celulaAdv(l), alinhar: 'dir' });
  return tabelaCortada(colunas, linhas, max);
}

function celulaAdv(l) {
  if (l.advNivel) return `${l.advNivel}ª`;
  return l.emCarencia ? 'novo' : '—';
}

// QUALIDADE: o que os recrutados acabaram virando, e as fichas/mantos do recrutador.
function tabelaQualidade(linhas, max = MAX_LINHAS_TABELA) {
  const colunas = [
    colunaNome,
    { titulo: 'PROBLEMAS', valor: l => (l.idFivem ? I.celulaFracao(l.problemas, l.recrutamentos) : '—'), alinhar: 'dir' },
    { titulo: 'FANTASMAS', valor: l => (l.idFivem ? I.celulaFracao(l.fantasmas, l.maduros) : '—'), alinhar: 'dir' },
  ];
  if (temCampo(linhas, 'erros7')) {
    colunas.push(
      { titulo: 'MANTO', valor: l => (l.erros7 === undefined ? '—' : String(l.erros7)), alinhar: 'dir' },
      { titulo: 'FICHAS', valor: l => (l.incompletas7 === undefined ? '—' : String(l.incompletas7)), alinhar: 'dir' },
    );
  }
  return tabelaCortada(colunas, linhas, max);
}

// Recrutadores com algo a olhar (risco de advertência, recrutados problemáticos,
// fantasmas), do mais para o menos urgente: quem já tem ADV ativa primeiro.
function textoAtencao(linhas, maximo = 8) {
  const com = linhas.filter(l => l.atencao?.length)
    .sort((a, b) => (b.advNivel ?? 0) - (a.advNivel ?? 0) || b.atencao.length - a.atencao.length);
  if (!com.length) return null;
  const itens = com.slice(0, maximo).map(l => `⚠️ **${escapeMarkdown(nomeCurto(l.nome))}** — ${l.atencao.join(' ')}`);
  const resto = com.length - itens.length;
  return [`**ATENÇÃO (${com.length}):**`, ...itens, ...(resto > 0 ? [`*+${resto} outro(s).*`] : [])].join('\n');
}

// Discord limita a soma de todos os embeds da mensagem a 6000 caracteres:
// encolhe as tabelas até caber.
const ORCAMENTO_TOTAL = 5600;

// Embeds do painel (fixo e ranking por período): resumo + desempenho, controle e
// qualidade, um embed cada, uma linha por recrutador.
function embedsRecrutadores({ titulo, resumo, linhas, agora = new Date() }) {
  const podio = textoPodio(linhas);
  const atencao = textoAtencao(linhas);
  const vazio = '*Nenhum membro com o cargo RECRUTADOR.*';
  const montar = max => {
    const partes = [
      {
        color: F.COR,
        title: titulo,
        description: [
          ...resumo, '', atencao, atencao ? '' : null, podio || null, podio ? '' : null,
          '**DESEMPENHO**', linhas.length ? tabelaRecrutadores(linhas, max) : vazio, linhas.length ? LEGENDA_TABELA : null,
        ].filter(x => x !== null && x !== undefined && x !== false).join('\n'),
      },
    ];
    if (linhas.length) {
      partes.push(
        { color: F.COR, description: ['**CONTROLE**', tabelaControle(linhas, max, agora), legendaControle(linhas)].join('\n') },
        { color: F.COR, description: ['**QUALIDADE DOS RECRUTADOS**', tabelaQualidade(linhas, max), legendaQualidade(linhas)].join('\n') },
      );
    }
    return partes;
  };
  const total = embeds => embeds.reduce((s, e) => s + (e.title?.length ?? 0) + e.description.length, 0);
  let max = MAX_LINHAS_TABELA;
  let embeds = montar(max);
  while (total(embeds) > ORCAMENTO_TOTAL && max > 5) {
    max -= 2;
    embeds = montar(max);
  }
  embeds[embeds.length - 1].footer = { text: F.rodape('canal logs-registros + logs-painel') };
  embeds[embeds.length - 1].timestamp = new Date().toISOString();
  return embeds;
}

const MEDALHAS =['🥇', '🥈', '🥉'];

// Pódio em texto (só quem recrutou de fato): dá o "quem lidera" de relance,
// antes da tabela.
function textoPodio(linhas) {
  return linhas
    .filter(l => l.recrutamentos > 0)
    .slice(0, 3)
    .map((l, i) => `${MEDALHAS[i]} **${escapeMarkdown(nomeCurto(l.nome))}** — ${E.formatarNumero(l.recrutamentos)} recrut. · ret. ${celulaRetencao(l.recrutamentos, l.saiuCedo)}`)
    .join('\n');
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
  const estadoPorId = new Map(estadoAgora.map(e => [e.id, e]));
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
    const conexao = m.idFivem ? estadoPorId.get(m.idFivem) : null;
    return {
      ...m, recrutamentos, ms, saiuCedo,
      online: m.idFivem ? idsOnline.has(m.idFivem) : false,
      ultimaConexao: conexao ? { acao: conexao.acao, em: conexao.ocorrido_em } : null,
    };
  });
  linhas.sort((a, b) => b.recrutamentos - a.recrutamentos || b.ms - a.ms);
  return linhas;
}

function embedsRankingRecrutadores(linhas, periodo) {
  const zerados = linhas.filter(l => l.recrutamentos === 0).length;
  const baixaRetencao = linhas.filter(l => l.recrutamentos >= 3 && (l.recrutamentos - l.saiuCedo) / l.recrutamentos < 0.5).length;
  return embedsRecrutadores({
    titulo: `🏆 RECRUTADORES — ${periodo.rotulo}`,
    resumo: [
      `**RECRUTADORES:** ${E.formatarNumero(linhas.length)}`,
      zerados ? `⚠️ **${E.formatarNumero(zerados)}** sem nenhum recrutamento no período.` : null,
      baixaRetencao ? `⚠️ **${E.formatarNumero(baixaRetencao)}** com retenção abaixo de 50% (mín. 3 recrutamentos).` : null,
    ].filter(Boolean),
    linhas,
  });
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

const seg = data => Math.floor(new Date(data).getTime() / 1000);

// Linhas da ficha vindas do cruzamento (`linha` = recrutadoresDoPeriodo +
// enriquecerRecrutadores; `horarios` = horariosDoRecrutador). Tudo opcional: sem
// cruzamento, a ficha fica como era.
function linhasInteligencia(linha, horarios) {
  if (!linha) return [];
  const out = [''];
  out.push(`**ÚLTIMO RECRUTAMENTO:** ${linha.ultimoRecrutou ? `<t:${seg(linha.ultimoRecrutou)}:R>` : 'nenhum registrado'}`);
  if (linha.meta) {
    out.push(`**META SEMANAL:** ${linha.rec7}/${linha.meta} recrutamentos nos últimos 7 dias (${I.celulaMeta(linha.rec7, linha.meta)})`);
  }
  out.push(`**QUALIDADE (${PERIODO_PADRAO.toUpperCase()}):** ${I.celulaFracao(linha.problemas, linha.recrutamentos)} recrutados com advertência, blacklist ou impedimento · ${I.celulaFracao(linha.fantasmas, linha.maduros)} nunca mais apareceram no jogo`);
  if (linha.disciplinaTexto) out.push(`**DISCIPLINA:** ${linha.disciplinaTexto}`);
  if (linha.atencao?.length) out.push(...linha.atencao.map(t => `⚠️ ${t}`));
  if (horarios) {
    const recruta = I.horasPico(horarios.recruta);
    const entra = I.horasPico(horarios.entra);
    const semRecrutar = I.horasSemRecrutar(horarios.entra, horarios.recruta);
    out.push('');
    out.push(`**RECRUTA MAIS ÀS:** ${recruta.join(' · ') || 'sem recrutamentos nos últimos 60 dias'}`);
    out.push(`**ENTRA NO JOGO MAIS ÀS:** ${entra.join(' · ') || 'sem entradas nos últimos 60 dias'}`);
    if (semRecrutar.length) out.push(`**ENTRA MAS NÃO RECRUTA ÀS:** ${semRecrutar.join(' · ')}`);
  }
  return out;
}

function embedFichaRecrutador(membro, ficha, porPeriodo, linha = null, horarios = null) {
  const linhas = [`**ID do jogo:** \`${ficha.idFivem}\``];
  linhas.push(ficha.sessaoAtual
    ? `**AGORA:** online desde <t:${seg(ficha.sessaoAtual.desde)}:R> — ${E.formatarDuracao(ficha.sessaoAtual.ms)}`
    : '**AGORA:** offline');
  for (const p of ficha.porPeriodo) {
    const { total, saiuCedo } = porPeriodo.get(p.chave) ?? { total: 0, saiuCedo: 0 };
    linhas.push(`**${p.rotulo}:** ${celulaTempo(p.ms)} jogado · ${E.formatarNumero(total)} recrutamento(s) · ${celulaRatio(total, p.ms)}/h · retenção ${celulaRetencao(total, saiuCedo)}`);
  }
  linhas.push(...linhasInteligencia(linha, horarios));
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
    await I.enriquecerRecrutadores(linhas, periodo);
    await interaction.editReply({ embeds: embedsRankingRecrutadores(linhas, periodo), allowedMentions: { parse: [] } });
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
    const periodoFicha = E.resolverPeriodo(PERIODO_PADRAO);
    const linhasFicha = await recrutadoresDoPeriodo(interaction.guild, periodoFicha);
    await I.enriquecerRecrutadores(linhasFicha, periodoFicha);
    const linha = linhasFicha.find(l => l.discordId === membro.id) ?? null;
    const horarios = await I.horariosDoRecrutador(idFivem).catch(err => {
      console.error('[painel-recrutadores] Erro ao ler horários:', err);
      return null;
    });
    await interaction.editReply({ embeds: [embedFichaRecrutador(membro, ficha, porPeriodo, linha, horarios)], allowedMentions: { parse: [] } });
    resetarPainelFixo(interaction.client);
    return;
  }

  if (interaction.isButton() && acao === 'meta') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    return interaction.showModal(modalMeta(await I.lerMeta()));
  }

  if (interaction.isModalSubmit() && acao === 'metamodal') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const bruto = interaction.fields.getTextInputValue('valor').trim();
    const valor = Number(bruto);
    if (!/^\d{1,3}$/.test(bruto) || !Number.isInteger(valor)) {
      return interaction.reply({ content: '❌ INFORME UM NÚMERO INTEIRO DE 0 A 999 (0 = SEM META).', flags: 64 });
    }
    await I.gravarMeta(valor);
    resetarPainelFixo(interaction.client);
    return interaction.reply({
      content: valor ? `🎯 META SEMANAL: **${valor}** RECRUTAMENTO(S) POR RECRUTADOR.` : '🎯 META SEMANAL DESLIGADA.',
      flags: 64,
    });
  }
});

module.exports = {
  linhaComponentesRecrutadores,
  recrutadoresDoPeriodo,
  tabelaRecrutadores,
  tabelaControle,
  tabelaQualidade,
  embedsRecrutadores,
  embedFichaRecrutador,
  nomeCurto,
  textoPodio,
  LEGENDA_TABELA,
  ACOES_RECRUTAMENTO,
  PERIODO_PADRAO,
};
