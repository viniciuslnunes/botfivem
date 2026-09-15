const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { registrarModulo } = require('../modulos');
const E = require('./estatisticas');
const F = require('./painelFormato');
const repo = require('./repositorio');
const { criarArmazemConsultas, mensagemErroConsulta } = require('./consultasEmMemoria');
const { selectPeriodo, linhaPaginacao } = require('./painelComponentesFixos');
const { gerarGraficoTerritoriosPorDia } = require('./graficoTerritoriosPorDia');

// Período padrão do botão RANKING — mesmo período que o card fixo resume
// (painelTerritorio.js usa '30d'), pra abrir exatamente o que a mensagem
// principal já está descrevendo, sem precisar escolher no select primeiro.
const PERIODO_RANKING_PADRAO = '30d';

// Canal 🗺️・dominacao-territorios: mesmo padrão interativo do 📦・estoque-bau.
// Coins de território não têm um "ator" (não é uma pessoa que gera o log, é o
// território em si) — por isso não há busca por jogador aqui, só período (o
// ranking de territórios) e o botão de territórios perdidos.
const MODULO = 'territorio';
const DOMINACAO = 'coins_dominacao';
const CONQUISTA = 'coins_conquista';
const ACOES = [DOMINACAO, CONQUISTA];
const PERDIDO_DIAS = 7;

function porTerritorio(linhas) {
  const mapa = new Map();
  for (const l of linhas) {
    const nome = E.corrigirMojibake(l.alvo);
    if (!mapa.has(nome)) mapa.set(nome, { territorio: nome, horas: 0, conquistas: 0, coins: 0, ultimaDominacao: null, ultimaConquista: null });
    const t = mapa.get(nome);
    t.coins += Number(l.soma) || 0;
    if (l.acao === DOMINACAO) { t.horas += l.total; t.ultimaDominacao = l.ultima; }
    if (l.acao === CONQUISTA) { t.conquistas += l.total; t.ultimaConquista = l.ultima; }
  }
  return [...mapa.values()].sort((a, b) => b.horas - a.horas || b.conquistas - a.conquistas || a.territorio.localeCompare(b.territorio, 'pt-BR'));
}

const armazem = criarArmazemConsultas();

// `linhasDiaAlvo` = repo.conquistasPorDiaEAlvo(periodo): [{ dia, alvo, total }],
// uma linha por (dia, território) — não agregado. Reduz pro MAIOR total de um
// único território em cada dia: é o que diferencia "5 conquistas espalhadas
// em 5 territórios" (sem disputa) de "o mesmo território retomado 5x"
// (disputa ativa). Devolve Map(dia -> { alvo, total }), só com dias que
// tiveram pelo menos 1 conquista.
function disputaPorDia(linhasDiaAlvo) {
  const porDia = new Map();
  for (const l of linhasDiaAlvo) {
    const atual = porDia.get(l.dia);
    if (!atual || l.total > atual.total) porDia.set(l.dia, { alvo: l.alvo, total: l.total });
  }
  return porDia;
}

// "🔥 Mais disputado: Hipódromo trocou de mão 5x em 13/09" — só quando algum
// dia teve o MESMO território retomado mais de uma vez (disputa de verdade,
// não só "teve conquista nesse dia").
function textoDisputa(mapaDisputa) {
  let pico = null;
  let diaPico = null;
  for (const [dia, d] of mapaDisputa) {
    if (d.total > 1 && (!pico || d.total > pico.total)) { pico = d; diaPico = dia; }
  }
  if (!pico) return null;
  return `🔥 **Mais disputado:** ${F.nomeSeguro(pico.alvo)} trocou de mão ${E.formatarNumero(pico.total)}x em ${E.formatarDiaCurto(diaPico)}.`;
}

// `linhasDiaAcao` = repo.porDiaEAcao(ACOES, periodo): [{ dia, acao, total }].
// `mapaDisputa` = disputaPorDia(repo.conquistasPorDiaEAlvo(...)) — vira a
// terceira série do gráfico (`disputa`): quantas vezes o território MAIS
// disputado daquele dia trocou de mão, pedido do usuário em 2026-09-15 pra
// essa informação estar DENTRO do gráfico, não só numa frase acima dele.
// Três séries contínuas (E.serieDiaria zera os dias sem log — sem isso um
// dia parado sumiria do eixo em vez de aparecer como barra/ponto zerado) no
// mesmo array que alimenta a sparkline de tendência (ver painelTerritorio.js
// e renderizarRanking). Período "tudo" não tem
// `inicio` fixo (ver estatisticas.resolverPeriodo) — usa o dia mais antigo
// que apareceu nos dados como início da série.
function serieTerritorioPorDia(linhasDiaAcao, mapaDisputa, periodo) {
  const porAcao = acao => linhasDiaAcao.filter(l => l.acao === acao).map(l => ({ dia: l.dia, total: l.total }));
  const fim = periodo.fim ?? new Date();
  let inicio = periodo.inicio;
  if (!inicio) {
    const dias = linhasDiaAcao.map(l => l.dia);
    inicio = dias.length ? new Date(`${dias.reduce((a, b) => (a < b ? a : b))}T00:00:00-03:00`) : fim;
  }
  const horas = E.serieDiaria(porAcao(DOMINACAO), inicio, fim);
  const conquistas = E.serieDiaria(porAcao(CONQUISTA), inicio, fim);
  const disputaLinhas = [...mapaDisputa].map(([dia, d]) => ({ dia, total: d.total }));
  const disputa = E.serieDiaria(disputaLinhas, inicio, fim);
  return horas.map((h, i) => ({
    dia: h.dia,
    horas: h.total,
    conquistas: conquistas[i]?.total ?? 0,
    disputa: disputa[i]?.total ?? 0,
  }));
}

// "1. Hipódromo — 68h de domínio · 15 conquistas · 354 coins · última
// conquista há 15h28min" — volta pra lista em texto (pedido do usuário em
// 2026-09-15, comparando com outro bot da comunidade: o gráfico de barras
// que existia aqui antes (2026-09-14, ver histórico do arquivo) ficou pouco
// intuitivo e escondia o detalhe — texto é selecionável/copiável, não
// depende de imagem carregar, e cabe o dado que a barra não mostrava (última
// conquista). `indice` é a posição GLOBAL no ranking (não a da página), pra
// não reiniciar a numeração em "1." a cada PRÓXIMA.
function linhaTerritorio(t, indice) {
  const ultima = t.ultimaConquista ?? t.ultimaDominacao;
  const conquistas = `${E.formatarNumero(t.conquistas)} ${t.conquistas === 1 ? 'conquista' : 'conquistas'}`;
  return `**${indice + 1}. ${F.nomeSeguro(t.territorio)}** — ${Math.round(t.horas)}h de domínio · ${conquistas} · ${E.formatarNumero(Math.round(t.coins))} coins`
    + (ultima ? ` · última conquista ${F.haQuantoTempo(ultima)}` : '');
}

// Versão curta pro bloco **HOJE** do painel fixo (painelTerritorio.js): só o
// que responde "quantas vezes e quantas horas HOJE", sem coins/última
// conquista (redundante quando o período já é o próprio dia). Mesma ordem
// (horas de domínio primeiro, depois conquistas) e o mesmo "de domínio" que
// linhaTerritorio usa no ranking completo — "Xh hoje" sozinho (versão
// anterior) ficou seco/ambíguo, pedido do usuário em 2026-09-15.
function linhaTerritorioHoje(t) {
  const conquistas = `${E.formatarNumero(t.conquistas)} ${t.conquistas === 1 ? 'conquista' : 'conquistas'}`;
  return `**${F.nomeSeguro(t.territorio)}** — ${Math.round(t.horas)}h de domínio hoje · ${conquistas}`;
}

// `consulta.chart` (PNG do domínio por dia, ver abrirRanking) é o mesmo em
// toda página — não depende do ranking paginado, só do período escolhido —
// mas precisa ir de novo em toda edição (`attachments: []` zera o anexo
// anterior a cada troca de página, mesmo motivo do painel fixo, ver
// painelTerritorio.js).
function renderizarRanking(consultaId, consulta) {
  const { itens, atual, totalPaginas } = armazem.pagina(consulta.territorios, consulta.pagina ?? 0);
  const horas = consulta.territorios.reduce((s, t) => s + t.horas, 0);
  const conquistas = consulta.territorios.reduce((s, t) => s + t.conquistas, 0);
  const offset = atual * armazem.porPagina;
  const disputa = consulta.disputaTexto;
  const embed = {
    color: F.COR,
    title: `🗺️ DOMINAÇÃO — ${consulta.rotulo}`,
    description: [
      `**${E.formatarNumero(horas)}h** de domínio · **${E.formatarNumero(conquistas)}** conquistas · **${consulta.territorios.length}** territórios`,
      ...(disputa ? [disputa] : []),
    ].join('\n'),
    fields: F.campoLista('RANKING', itens.map((t, i) => linhaTerritorio(t, offset + i)), 'Nenhum território dominado no período.', { numerar: false }),
    image: consulta.chart ? { url: 'attachment://dominacao-dias.png' } : undefined,
    footer: { text: `${F.rodape('canal logs-banco')} · Página ${atual + 1}/${totalPaginas}` },
  };
  return {
    embeds: [embed],
    components: [linhaPaginacao(MODULO, consultaId, atual, totalPaginas, { comBusca: false })],
    attachments: [],
    files: consulta.chart ? [{ attachment: consulta.chart, name: 'dominacao-dias.png' }] : [],
    allowedMentions: { parse: [] },
  };
}

async function abrirRanking(interaction, periodo) {
  const [linhas, linhasDia, linhasDiaAlvo] = await Promise.all([
    repo.resumoPorAlvo(ACOES, periodo),
    repo.porDiaEAcao(ACOES, periodo),
    repo.conquistasPorDiaEAlvo(periodo),
  ]);
  const territorios = porTerritorio(linhas);
  const mapaDisputa = disputaPorDia(linhasDiaAlvo);
  const serie = serieTerritorioPorDia(linhasDia, mapaDisputa, periodo);
  const chart = serie.some(s => s.horas || s.conquistas) ? await gerarGraficoTerritoriosPorDia(serie) : null;
  const dados = { territorios, rotulo: periodo.rotulo, pagina: 0, disputaTexto: textoDisputa(mapaDisputa), chart };
  const consultaId = armazem.salvar(interaction.user.id, dados);
  await interaction.editReply(renderizarRanking(consultaId, dados));
}

async function embedPerdidos() {
  const agora = new Date();
  const recente = { inicio: new Date(agora.getTime() - PERDIDO_DIAS * E.DIA_MS), fim: agora };
  const [linhasTudo, linhasRecentes] = await Promise.all([
    repo.resumoPorAlvo(ACOES, E.resolverPeriodo('tudo', agora)),
    repo.resumoPorAlvo(ACOES, recente),
  ]);
  const conhecidos = porTerritorio(linhasTudo);
  const dominadosRecentes = new Set(porTerritorio(linhasRecentes).map(t => t.territorio));
  const perdidos = conhecidos.filter(t => !dominadosRecentes.has(t.territorio));
  const linhas = perdidos.map(t => `• **${F.nomeSeguro(t.territorio)}** — ${(t.ultimaDominacao ?? t.ultimaConquista) ? `último domínio ${F.haQuantoTempo(t.ultimaDominacao ?? t.ultimaConquista)}` : 'sem data'}`);
  return {
    color: F.COR,
    title: `⚠️ TERRITÓRIOS SEM DOMÍNIO HÁ ${PERDIDO_DIAS} DIAS`,
    description: perdidos.length ? `**${perdidos.length}** de **${conhecidos.length}** territórios já dominados:` : 'Todo território já dominado segue ativo.',
    fields: perdidos.length ? F.campoLista('TERRITÓRIOS', linhas, '') : [],
    footer: { text: F.rodape('canal logs-banco') },
  };
}

// RANKING ao lado de TERRITÓRIOS PERDIDOS, na mesma linha — pedido do
// usuário em 2026-09-15: a listagem completa (24 territórios) saiu do card
// fixo (ficou grande demais sempre visível) e só abre por aqui agora, com o
// período padrão (30d, mesmo que o resumo do card descreve) sem precisar
// escolher no select primeiro. O select de período continua existindo pra
// abrir o MESMO ranking em qualquer outro período.
function linhaComponentesTerritorio() {
  return [
    selectPeriodo(MODULO, { placeholder: 'VER DOMINAÇÃO DE UM PERÍODO' }),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${MODULO}:ranking`).setLabel('RANKING').setStyle(ButtonStyle.Secondary).setEmoji('🏆'),
      new ButtonBuilder().setCustomId(`${MODULO}:perdidos`).setLabel('TERRITÓRIOS PERDIDOS').setStyle(ButtonStyle.Secondary).setEmoji('⚠️'),
    ),
  ];
}

registrarModulo(MODULO, async interaction => {
  const [, acao, a, b] = interaction.customId.split(':');

  if (interaction.isStringSelectMenu() && acao === 'selperiodo') {
    await interaction.deferReply({ flags: 64 });
    await abrirRanking(interaction, E.resolverPeriodo(interaction.values[0]));
    return;
  }

  if (interaction.isButton() && acao === 'ranking') {
    await interaction.deferReply({ flags: 64 });
    await abrirRanking(interaction, E.resolverPeriodo(PERIODO_RANKING_PADRAO));
    return;
  }

  if (interaction.isButton() && acao === 'perdidos') {
    await interaction.deferReply({ flags: 64 });
    await interaction.editReply({ embeds: [await embedPerdidos()] });
    return;
  }

  if (interaction.isButton() && acao === 'pag') {
    const { erro } = armazem.obter(a, interaction.user.id);
    if (erro) return interaction.update({ content: mensagemErroConsulta(erro), embeds: [], components: [] });
    const atualizada = armazem.atualizar(a, { pagina: Number(b) || 0 });
    await interaction.update(renderizarRanking(a, atualizada));
    return;
  }
});

module.exports = {
  linhaComponentesTerritorio, porTerritorio, linhaTerritorio, linhaTerritorioHoje, disputaPorDia, textoDisputa, serieTerritorioPorDia,
};
