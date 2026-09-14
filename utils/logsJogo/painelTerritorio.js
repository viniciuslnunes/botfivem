const E = require('./estatisticas');
const F = require('./painelFormato');
const repo = require('./repositorio');
const { criarPainelCanal } = require('./painelCanal');
const { linhaComponentesTerritorio, porTerritorio } = require('./painelTerritorioInteracoes');
const { gerarGraficoTerritorios } = require('./graficoTerritorios');

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
// Gráfico de barras (canvas, ver graficoTerritorios.js) em vez da tabela em
// texto que estava aqui antes — mesmo pedido do usuário, "melhorar com a
// melhor ferramenta pro fluxo": comparar barra com barra bate mais rápido
// que ler números alinhados, e o painel já reenvia attachment a cada edição
// de qualquer forma (mesmo custo de qualquer canal-painel com imagem, ver
// gerarGraficoOcupacao em presencaInteracoes.js).
const TOP_FIXO = 10;

async function montarBlocos() {
  const mes = E.resolverPeriodo('30d');
  const [linhasMes, ultima] = await Promise.all([repo.resumoPorAlvo(ACOES, mes), repo.ultimaOcorrencia(ACOES)]);
  const territorios = porTerritorio(linhasMes);
  const horas = territorios.reduce((s, t) => s + t.horas, 0);
  const conquistas = territorios.reduce((s, t) => s + t.conquistas, 0);
  const aviso = F.avisoFonteParada(ultima);
  const top = territorios.slice(0, TOP_FIXO);

  const embed = {
    color: F.COR,
    title: '🗺️ DOMINAÇÃO DE TERRITÓRIOS — GAVIÕES DA FIEL FIVEM',
    description: [
      ...(aviso ? [aviso, ''] : []),
      `**ÚLTIMOS 30 DIAS:** ${E.formatarNumero(horas)}h de domínio · ${E.formatarNumero(conquistas)} conquistas · ${E.formatarNumero(territorios.length)} territórios`,
      ...(top.length ? [`\n**TOP ${top.length}**`] : []),
    ].join('\n'),
    footer: { text: F.rodape('canal logs-banco') },
    timestamp: new Date().toISOString(),
  };
  let files = [];
  if (top.length) {
    embed.image = { url: 'attachment://dominacao.png' };
    files = [{ attachment: gerarGraficoTerritorios(top), name: 'dominacao.png' }];
  }
  // `attachments: []` é obrigatório em toda edição (não só quando não tem
  // gráfico pra mostrar): sem isso, o Discord MANTÉM o anexo da edição
  // anterior e só ACRESCENTA o novo — como este painel reedita a cada ciclo/
  // log novo (às vezes a cada 30s), a mensagem acumularia um PNG a mais por
  // ciclo até estourar o limite de anexos do Discord e o painel parar de
  // atualizar sem aviso nenhum. `attachments: []` zera antes; `files` (se
  // tiver) sobe o de agora — juntos, cada edição troca a imagem, não empilha.
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
