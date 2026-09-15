const E = require('./estatisticas');
const F = require('./painelFormato');
const repo = require('./repositorio');
const { criarPainelCanal } = require('./painelCanal');
const {
  linhaComponentesTerritorio, porTerritorio, linhaTerritorio, linhaTerritorioHoje, disputaPorDia, textoDisputa, serieTerritorioPorDia,
} = require('./painelTerritorioInteracoes');

// Canal 🗺️・dominacao-territorios: mensagem fixa curta (padrão interativo, ver
// painelBau.js). Público — conquista é orgulho da torcida, não auditoria.
// Detalhe (ranking paginado por período, territórios perdidos) mora em
// painelTerritorioInteracoes.js.
const SLUG = 'dominacao_territorios';
const ACOES = ['coins_dominacao', 'coins_conquista'];

// Ranking completo (todos os territórios, não só um TOP) direto na mensagem
// fixa — pedido do usuário em 2026-09-15: cortar em 10 escondia mais de
// metade dos territórios (24 no total) atrás do select. `campoLista` já
// quebra em mais de um field sozinho se passar de 1024 caracteres, então
// listar todos não tem custo.
// Sem gráfico de imagem (Chart.js/PNG, ver histórico do arquivo até
// 2026-09-15): confuso pra ler de relance. No lugar, o mesmo padrão que
// /estatisticas já usa (relatorios.js: sparkline de texto + intervalo de
// datas) pra tendência dos 30 dias, e uma lista à parte **HOJE** — nome do
// território, quantas vezes foi dominado e quantas horas, só do dia atual —
// que é a pergunta que o usuário quer responder de relance sem clicar em
// nada (o select continua servindo pra qualquer outro período).
async function montarBlocos() {
  const mes = E.resolverPeriodo('30d');
  const hoje = E.resolverPeriodo('hoje');
  const [linhasMes, ultima, linhasDia, linhasDiaAlvo, linhasHoje] = await Promise.all([
    repo.resumoPorAlvo(ACOES, mes),
    repo.ultimaOcorrencia(ACOES),
    repo.porDiaEAcao(ACOES, mes),
    repo.conquistasPorDiaEAlvo(mes),
    repo.resumoPorAlvo(ACOES, hoje),
  ]);
  const territorios = porTerritorio(linhasMes);
  const territoriosHoje = porTerritorio(linhasHoje);
  const horas = territorios.reduce((s, t) => s + t.horas, 0);
  const conquistas = territorios.reduce((s, t) => s + t.conquistas, 0);
  const aviso = F.avisoFonteParada(ultima);
  const mapaDisputa = disputaPorDia(linhasDiaAlvo);
  const disputa = textoDisputa(mapaDisputa);
  const serie = serieTerritorioPorDia(linhasDia, mapaDisputa, mes);
  const tendencia = serie.some(s => s.horas)
    ? [`\`${E.sparkline(serie.map(s => s.horas))}\` horas de domínio/dia`, `${E.formatarDiaCurto(serie[0].dia)} → ${E.formatarDiaCurto(serie[serie.length - 1].dia)}`]
    : [];

  const embed = {
    color: F.COR,
    title: '🗺️ DOMINAÇÃO DE TERRITÓRIOS — GAVIÕES DA FIEL FIVEM',
    description: [
      ...(aviso ? [aviso, ''] : []),
      `**ÚLTIMOS 30 DIAS:** ${E.formatarNumero(horas)}h de domínio · ${E.formatarNumero(conquistas)} conquistas · ${E.formatarNumero(territorios.length)} territórios`,
      ...(disputa ? [disputa] : []),
      ...(tendencia.length ? ['', ...tendencia] : []),
      ...(territorios.length ? [] : ['', '*Nenhum território dominado nos últimos 30 dias.*']),
    ].join('\n'),
    fields: [
      ...F.campoLista('HOJE', territoriosHoje.map(t => linhaTerritorioHoje(t)), 'Nenhum território dominado hoje ainda.'),
      ...(territorios.length ? F.campoLista(`RANKING (${territorios.length})`, territorios.map((t, i) => linhaTerritorio(t, i)), '') : []),
    ],
    footer: { text: F.rodape('canal logs-banco') },
    timestamp: new Date().toISOString(),
  };
  return [{ embeds: [embed], components: linhaComponentesTerritorio(), attachments: [], files: [], allowedMentions: { parse: [] } }];
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '🗺️・dominacao-territorios',
  razao: 'Dominação e conquista de territórios a partir das coins do jogo',
  publico: true,
  intervaloMin: 30,
  montarBlocos,
});

module.exports = {
  iniciarPainelTerritorio: painel.iniciar,
  atualizarPainelTerritorio: painel.atualizar,
  agendarAtualizacaoReativa: painel.agendarAtualizacaoReativa,
};
