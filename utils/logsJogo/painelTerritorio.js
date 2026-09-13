const repo = require('./repositorio');
const E = require('./estatisticas');
const F = require('./painelFormato');
const { criarPainelCanal } = require('./painelCanal');
const { registrarConsulta, selectPeriodo } = require('./painelConsulta');

// Canal 🗺️・dominacao-territorios: quais territórios do mapa a torcida domina,
// por quanto tempo e quantas vezes conquistou — a partir das Coins do canal
// logs-banco.
//
// Como o dado vira hora: o jogo paga "+3 coins" com a origem "Dominação (1h):
// <território>" a cada hora que a torcida segura o território, e "+10" com
// "Conquista: <território>" no momento em que toma. Então contar logs de
// dominação = contar horas de domínio, e contar conquistas = quantas vezes o
// território foi (re)tomado. Territórios em paralelo somam horas em paralelo.
//
// "Sem domínio há 7 dias" é a leitura que gera ação: território que a torcida
// já teve e perdeu.
const SLUG = 'dominacao_territorios';
const DOMINACAO = 'coins_dominacao';
const CONQUISTA = 'coins_conquista';
const ACOES = [DOMINACAO, CONQUISTA];
const PERDIDO_DIAS = 7;

// Uma linha por território a partir das linhas (território, ação) da consulta.
function porTerritorio(linhas) {
  const mapa = new Map();
  for (const l of linhas) {
    const nome = E.corrigirMojibake(l.alvo);
    if (!mapa.has(nome)) {
      mapa.set(nome, { territorio: nome, horas: 0, conquistas: 0, coins: 0, ultimaDominacao: null, ultimaConquista: null });
    }
    const t = mapa.get(nome);
    t.coins += Number(l.soma) || 0;
    if (l.acao === DOMINACAO) {
      t.horas += l.total;
      t.ultimaDominacao = l.ultima;
    }
    if (l.acao === CONQUISTA) {
      t.conquistas += l.total;
      t.ultimaConquista = l.ultima;
    }
  }
  return [...mapa.values()]
    .sort((a, b) => b.horas - a.horas || b.conquistas - a.conquistas || a.territorio.localeCompare(b.territorio, 'pt-BR'));
}

function linhaTerritorio(t, i) {
  return `${i + 1}. **${F.nomeSeguro(t.territorio)}** — **${E.formatarNumero(t.horas)}h** de domínio`
    + ` · ${E.formatarNumero(t.conquistas)} ${t.conquistas === 1 ? 'conquista' : 'conquistas'}`
    + ` · ${E.formatarNumero(t.coins)} coins`
    + (t.ultimaConquista ? ` · última conquista ${F.haQuantoTempo(t.ultimaConquista)}` : '');
}

function linhaPerdido(t) {
  const ultima = t.ultimaDominacao ?? t.ultimaConquista;
  return `• **${F.nomeSeguro(t.territorio)}** — ${ultima ? `último domínio ${F.haQuantoTempo(ultima)}` : 'sem data'}`;
}

function cabecalho(rotulo, territorios, porDia, periodo, aviso) {
  const horas = territorios.reduce((s, t) => s + t.horas, 0);
  const conquistas = territorios.reduce((s, t) => s + t.conquistas, 0);
  const coins = territorios.reduce((s, t) => s + t.coins, 0);
  const linhas = [
    ...(aviso ? [aviso, ''] : []),
    `**${rotulo}:** **${E.formatarNumero(horas)}h** de domínio · **${E.formatarNumero(conquistas)}** conquistas · **${E.formatarNumero(coins)}** coins`,
    `**${territorios.length}** ${territorios.length === 1 ? 'território dominado' : 'territórios dominados'} no período`,
  ];
  if (porDia.length && periodo.inicio) {
    const serie = E.serieDiaria(porDia, periodo.inicio, periodo.fim);
    linhas.push('', `\`${E.sparkline(serie.map(d => d.total))}\``,
      `${E.formatarDiaCurto(serie[0].dia)} → ${E.formatarDiaCurto(serie[serie.length - 1].dia)} (horas de domínio por dia)`);
  }
  linhas.push('', '*1 log "Dominação (1h)" = 1 hora com o território. Territórios ao mesmo tempo somam horas ao mesmo tempo.*');
  return linhas.join('\n');
}

async function montarBlocos() {
  const agora = new Date();
  const mes = E.resolverPeriodo('30d', agora);
  const recente = { inicio: new Date(agora.getTime() - PERDIDO_DIAS * E.DIA_MS), fim: agora };
  const [linhasMes, linhasRecentes, linhasTudo, porDia, ultima] = await Promise.all([
    repo.resumoPorAlvo(ACOES, mes),
    repo.resumoPorAlvo(ACOES, recente),
    repo.resumoPorAlvo(ACOES, E.resolverPeriodo('tudo', agora)),
    repo.contarPorDiaPorAcoes([DOMINACAO], mes),
    repo.ultimaOcorrencia(ACOES),
  ]);

  const doMes = porTerritorio(linhasMes);
  const dominadosRecentes = new Set(porTerritorio(linhasRecentes).map(t => t.territorio));
  const conhecidos = porTerritorio(linhasTudo);
  const perdidos = conhecidos.filter(t => !dominadosRecentes.has(t.territorio));

  return F.blocosDeEmbeds(F.embedsDeLista({
    titulo: '🗺️ DOMINAÇÃO DE TERRITÓRIOS — ÚLTIMOS 30 DIAS',
    cabecalho: cabecalho('ÚLTIMOS 30 DIAS', doMes, porDia, mes, F.avisoFonteParada(ultima, agora)),
    linhas: doMes.map(linhaTerritorio),
    vazio: 'Nenhum território dominado nos últimos 30 dias.',
    origem: 'canal logs-banco',
    fields: perdidos.length
      ? [{
        name: `⚠️ SEM DOMÍNIO HÁ ${PERDIDO_DIAS} DIAS (${perdidos.length} de ${conhecidos.length} já dominados)`,
        value: E.truncar(perdidos.map(linhaPerdido).join('\n'), 1024),
      }]
      : [],
  }));
}

function montarAcao() {
  return {
    content: '👇 **VER A DOMINAÇÃO DE OUTRO PERÍODO**',
    components: [selectPeriodo(SLUG, 'ESCOLHA UM PERÍODO')],
  };
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '🗺️・dominacao-territorios',
  razao: 'Dominação e conquista de territórios a partir das coins do jogo',
  publico: true, // conquista é orgulho da torcida, não auditoria
  intervaloMin: 30,
  montarBlocos,
  montarAcao,
});

registrarConsulta(SLUG, async periodo => {
  const [linhas, porDia] = await Promise.all([
    repo.resumoPorAlvo(ACOES, periodo),
    repo.contarPorDiaPorAcoes([DOMINACAO], periodo),
  ]);
  const territorios = porTerritorio(linhas);
  return {
    embeds: F.embedsDeLista({
      titulo: `🗺️ DOMINAÇÃO — ${periodo.rotulo}`,
      cabecalho: cabecalho(periodo.rotulo, territorios, porDia, periodo, null),
      linhas: territorios.map(linhaTerritorio),
      vazio: 'Nenhum território dominado no período.',
      origem: 'canal logs-banco',
    }).slice(0, 1),
  };
}, painel.agendarAtualizacaoReativa);

module.exports = {
  porTerritorio,
  iniciarPainelTerritorio: painel.iniciar,
  atualizarPainelTerritorio: painel.atualizar,
  agendarAtualizacaoReativa: painel.agendarAtualizacaoReativa,
};
