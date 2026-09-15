const E = require('./estatisticas');
const F = require('./painelFormato');
const repo = require('./repositorio');
const { criarPainelCanal } = require('./painelCanal');
const {
  linhaComponentesTerritorio, porTerritorio, linhaTerritorio, disputaPorDia, textoDisputa, serieTerritorioPorDia,
} = require('./painelTerritorioInteracoes');
const { gerarGraficoTerritoriosPorDia } = require('./graficoTerritoriosPorDia');

// Canal 🗺️・dominacao-territorios: mensagem fixa curta (padrão interativo, ver
// painelBau.js). Público — conquista é orgulho da torcida, não auditoria.
// Detalhe (ranking paginado por período, territórios perdidos) mora em
// painelTerritorioInteracoes.js.
const SLUG = 'dominacao_territorios';
const ACOES = ['coins_dominacao', 'coins_conquista'];

// TOP fixo dos últimos 30 dias direto na mensagem sempre visível — pedido do
// usuário em 2026-09-14: antes só dava pra ver o ranking clicando no select
// (resposta ephemeral, foto parada na hora do clique). Como este painel já
// reage sozinho a log novo (agendarAtualizacaoReativa, debounce de 30s — ver
// painelCanal.js), o TOP fixo atualiza na hora sem precisar clicar em nada;
// o select continua só pra ver outro período ou passar dos 10 primeiros.
// Lista em TEXTO (linhaTerritorio) pro ranking em si — pedido do usuário em
// 2026-09-15 comparando com outro bot da comunidade, texto é mais legível
// que barra por barra — MAIS um gráfico por DIA (não por território,
// gerarGraficoTerritoriosPorDia) porque o eixo que importa aqui é o tempo:
// quanto foi dominado cada dia e quantas vezes um território trocou de mão
// no mesmo dia (disputa), não um ranking estático.
const TOP_FIXO = 10;

async function montarBlocos() {
  const mes = E.resolverPeriodo('30d');
  const [linhasMes, ultima, linhasDia, linhasDiaAlvo] = await Promise.all([
    repo.resumoPorAlvo(ACOES, mes),
    repo.ultimaOcorrencia(ACOES),
    repo.porDiaEAcao(ACOES, mes),
    repo.conquistasPorDiaEAlvo(mes),
  ]);
  const territorios = porTerritorio(linhasMes);
  const horas = territorios.reduce((s, t) => s + t.horas, 0);
  const conquistas = territorios.reduce((s, t) => s + t.conquistas, 0);
  const aviso = F.avisoFonteParada(ultima);
  const top = territorios.slice(0, TOP_FIXO);
  const mapaDisputa = disputaPorDia(linhasDiaAlvo);
  const disputa = textoDisputa(mapaDisputa);
  const serie = serieTerritorioPorDia(linhasDia, mapaDisputa, mes);
  const chart = serie.some(s => s.horas || s.conquistas) ? await gerarGraficoTerritoriosPorDia(serie) : null;

  const embed = {
    color: F.COR,
    title: '🗺️ DOMINAÇÃO DE TERRITÓRIOS — GAVIÕES DA FIEL FIVEM',
    description: [
      ...(aviso ? [aviso, ''] : []),
      `**ÚLTIMOS 30 DIAS:** ${E.formatarNumero(horas)}h de domínio · ${E.formatarNumero(conquistas)} conquistas · ${E.formatarNumero(territorios.length)} territórios`,
      ...(disputa ? [disputa] : []),
      ...(top.length ? [] : ['', '*Nenhum território dominado nos últimos 30 dias.*']),
    ].join('\n'),
    fields: top.length ? F.campoLista(`TOP ${top.length}`, top.map((t, i) => linhaTerritorio(t, i)), '') : [],
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
