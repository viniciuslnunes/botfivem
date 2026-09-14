const { registrarModulo } = require('../modulos');
const E = require('./estatisticas');
const F = require('./painelFormato');
const repo = require('./repositorio');
const { criarArmazemConsultas, mensagemErroConsulta } = require('./consultasEmMemoria');
const { selectPeriodo, linhaBotao, linhaPaginacao } = require('./painelComponentesFixos');
const { gerarGraficoTerritorios } = require('./graficoTerritorios');

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

// Gráfico de barras (canvas, ver graficoTerritorios.js) em vez da tabela em
// texto que estava aqui antes — pedido do usuário em 2026-09-14 ("melhore
// mais, com as melhores ferramentas ou bibliotecas pra este fluxo"): com 3
// números por território (domínio, conquistas, coins), tanto a lista
// numerada quanto a tabela em texto viravam parede difícil de comparar item
// a item; barra ao lado de barra resolve isso de vez. Mesmo tratamento do
// TOP fixo do painel (painelTerritorio.js).
function renderizarRanking(consultaId, consulta) {
  const { itens, atual, totalPaginas } = armazem.pagina(consulta.territorios, consulta.pagina ?? 0);
  const horas = consulta.territorios.reduce((s, t) => s + t.horas, 0);
  const conquistas = consulta.territorios.reduce((s, t) => s + t.conquistas, 0);
  const embed = {
    color: F.COR,
    title: `🗺️ DOMINAÇÃO — ${consulta.rotulo}`,
    description: itens.length
      ? `**${E.formatarNumero(horas)}h** de domínio · **${E.formatarNumero(conquistas)}** conquistas · **${consulta.territorios.length}** territórios`
      : `**${E.formatarNumero(horas)}h** de domínio · **${E.formatarNumero(conquistas)}** conquistas · **${consulta.territorios.length}** territórios\n\n*Nenhum território dominado no período.*`,
    footer: { text: `${F.rodape('canal logs-banco')} · Página ${atual + 1}/${totalPaginas}` },
  };
  // `attachments: []` é obrigatório em toda edição (não só na 1ª página): sem
  // isso o Discord mantém o gráfico da página anterior e só ACRESCENTA o
  // novo — clicar em ANTERIOR/PRÓXIMA repetidas vezes empilharia um PNG a
  // mais por clique na mesma mensagem (ver mesmo comentário em
  // painelTerritorio.js). `files` (se tiver itens) sobe o gráfico desta página.
  const files = itens.length ? [{ attachment: gerarGraficoTerritorios(itens), name: 'dominacao.png' }] : [];
  if (itens.length) embed.image = { url: 'attachment://dominacao.png' };
  return {
    embeds: [embed],
    components: [linhaPaginacao(MODULO, consultaId, atual, totalPaginas, { comBusca: false })],
    attachments: [],
    files,
    allowedMentions: { parse: [] },
  };
}

async function abrirRanking(interaction, periodo) {
  const linhas = await repo.resumoPorAlvo(ACOES, periodo);
  const territorios = porTerritorio(linhas);
  const dados = { territorios, rotulo: periodo.rotulo, pagina: 0 };
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

function linhaComponentesTerritorio() {
  return [
    selectPeriodo(MODULO, { placeholder: 'VER DOMINAÇÃO DE UM PERÍODO' }),
    linhaBotao(MODULO, 'perdidos', 'TERRITÓRIOS PERDIDOS', { emoji: '⚠️' }),
  ];
}

registrarModulo(MODULO, async interaction => {
  const [, acao, a, b] = interaction.customId.split(':');

  if (interaction.isStringSelectMenu() && acao === 'selperiodo') {
    await interaction.deferReply({ flags: 64 });
    await abrirRanking(interaction, E.resolverPeriodo(interaction.values[0]));
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

module.exports = { linhaComponentesTerritorio, porTerritorio };
