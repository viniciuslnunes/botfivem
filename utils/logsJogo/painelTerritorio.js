const E = require('./estatisticas');
const F = require('./painelFormato');
const repo = require('./repositorio');
const { criarPainelCanal } = require('./painelCanal');
const {
  linhaComponentesTerritorio, porTerritorio, linhaTerritorioHoje, disputaPorDia, textoDisputa, serieTerritorioPorDia,
} = require('./painelTerritorioInteracoes');
const { gerarGraficoTerritoriosPorDia } = require('./graficoTerritoriosPorDia');

// Canal 🗺️・dominacao-territorios: mensagem fixa curta (padrão interativo, ver
// painelBau.js). Público — conquista é orgulho da torcida, não auditoria.
// Detalhe (ranking paginado por período, territórios perdidos) mora em
// painelTerritorioInteracoes.js.
const SLUG = 'dominacao_territorios';
const ACOES = ['coins_dominacao', 'coins_conquista'];

// Card fixo: resumo (30 dias) + destaque de disputa + gráfico por dia
// (graficoTerritoriosPorDia.js) + tabela compacta com TODOS os territórios
// do período (nome, horas de domínio, conquistas) + **HOJE** (só o que
// teve atividade no dia). A tabela em bloco monoespaçado (F.tabela) volta a
// mostrar os 24 territórios direto no card — pedido do usuário em
// 2026-09-17 — sem repetir o problema de 2026-09-15 (lista em texto rico
// com negrito/emoji por linha deixava a mensagem grande demais): uma linha
// por território sem markdown por linha é bem mais compacta. O botão
// RANKING (linhaComponentesTerritorio, em painelTerritorioInteracoes.js)
// continua existindo pra ver outros períodos e o detalhe de "última
// conquista" que a tabela não carrega.
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
  const chart = serie.some(s => s.horas || s.conquistas) ? await gerarGraficoTerritoriosPorDia(serie) : null;
  const tabelaRanking = F.tabela([
    { titulo: '#', valor: (t, i) => String(i + 1), alinhar: 'dir' },
    { titulo: 'TERRITÓRIO', valor: t => t.territorio, alinhar: 'esq', larguraMax: 18 },
    { titulo: 'DOMÍNIO', valor: t => `${Math.round(t.horas)}h`, alinhar: 'dir' },
    { titulo: 'CONQ.', valor: t => E.formatarNumero(t.conquistas), alinhar: 'dir' },
  ], territorios);

  const embed = {
    color: F.COR,
    title: '🗺️ DOMINAÇÃO DE TERRITÓRIOS — GAVIÕES DA FIEL FIVEM',
    description: [
      ...(aviso ? [aviso, ''] : []),
      `**ÚLTIMOS 30 DIAS:** ${E.formatarNumero(horas)}h de domínio · ${E.formatarNumero(conquistas)} conquistas · ${E.formatarNumero(territorios.length)} territórios`,
      ...(disputa ? [disputa] : []),
      ...(territorios.length ? ['', tabelaRanking] : ['', '*Nenhum território dominado nos últimos 30 dias.*']),
    ].join('\n'),
    fields: F.campoLista('HOJE', territoriosHoje.map(t => linhaTerritorioHoje(t)), 'Nenhum território dominado hoje ainda.'),
    image: chart ? { url: 'attachment://dominacao-dias.png' } : undefined,
    footer: { text: F.rodape('canal logs-banco') },
    timestamp: new Date().toISOString(),
  };
  // `attachments: []` é obrigatório em toda edição, senão o Discord mantém o
  // gráfico da edição anterior e só ACRESCENTA o novo — como este painel
  // reedita a cada ciclo/log novo (às vezes a cada 30s), a mensagem
  // acumularia um PNG a mais por ciclo até estourar o limite de anexos do
  // Discord e o painel parar de atualizar sem aviso nenhum.
  const files = chart ? [{ attachment: chart, name: 'dominacao-dias.png' }] : [];
  return [{ embeds: [embed], components: linhaComponentesTerritorio(), attachments: [], files, allowedMentions: { parse: [] } }];
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
