const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
require('chart.js/auto');
const E = require('./estatisticas');

// Domínio de territórios por DIA (não por território, como o gráfico de
// barras que passou por aqui em 2026-09-14/15) — pedido do usuário em
// 2026-09-15: o eixo que importa pra "inteligência" é o tempo (quanto foi
// dominado cada dia, e quantas vezes um território trocou de mão no mesmo
// dia — disputa), não um ranking estático. Chart.js (via chartjs-node-canvas)
// em vez do canvas desenhado à mão que o resto do bot usa (graficoOcupacao.js,
// graficoTerritorios.js antigo): duas séries com eixos Y independentes (barra
// de horas + linha de conquistas) é exatamente o caso em que uma lib de
// gráfico de verdade — eixo duplo, legenda, grade — vale mais que reimplementar
// isso à mão. Continua uma imagem estática (PNG), reenviada a cada edição do
// painel: não existe gráfico "vivo" dentro de um embed do Discord.

const W = 700;
const H = 320;
const FUNDO = '#000000';
const GRADE = '#262626';
const TEXTO = '#FFFFFF';
const TEXTO_FRACO = '#999999';
const COR_HORAS = '#8C8C8C';
const COR_CONQUISTAS = '#FFFFFF';
const COR_DISPUTA = '#CFCFCF';

const chartJSNodeCanvas = new ChartJSNodeCanvas({ width: W, height: H, backgroundColour: FUNDO });

// `serie` = [{ dia: 'YYYY-MM-DD', horas, conquistas, disputa }], contínua
// (sem buraco nos dias sem log — ver serieTerritorioPorDia em
// painelTerritorioInteracoes.js) e em ordem cronológica. `disputa` é quantas
// vezes o território MAIS disputado daquele dia trocou de mão — diferente de
// `conquistas` (soma de TODOS os territórios no dia): um dia com 5
// conquistas pode ser 5 territórios diferentes (disputa baixa) ou o mesmo
// território retomado 5x (disputa alta), e só essa terceira série distingue
// os dois casos — pedido do usuário em 2026-09-15 pra essa informação estar
// DENTRO do gráfico, não só numa frase de destaque acima dele.
function gerarGraficoTerritoriosPorDia(serie) {
  const muitosDias = serie.length > 45; // esconde os pontos da linha quando lota (ex.: período "tudo")
  const configuration = {
    data: {
      labels: serie.map(s => E.formatarDiaCurto(s.dia)),
      datasets: [
        {
          type: 'bar',
          label: 'Horas de domínio',
          data: serie.map(s => s.horas),
          backgroundColor: COR_HORAS,
          yAxisID: 'horas',
          order: 3,
        },
        {
          type: 'line',
          label: 'Conquistas (total do dia)',
          data: serie.map(s => s.conquistas),
          borderColor: COR_CONQUISTAS,
          backgroundColor: COR_CONQUISTAS,
          pointRadius: muitosDias ? 0 : 3,
          tension: 0.25,
          yAxisID: 'conquistas',
          order: 1,
        },
        {
          type: 'line',
          label: 'Maior disputa (mesmo território)',
          data: serie.map(s => s.disputa),
          borderColor: COR_DISPUTA,
          backgroundColor: COR_DISPUTA,
          borderDash: [5, 3],
          pointStyle: 'triangle',
          pointRadius: muitosDias ? 0 : 4,
          tension: 0.25,
          yAxisID: 'conquistas',
          order: 2,
        },
      ],
    },
    options: {
      layout: { padding: 8 },
      plugins: {
        legend: { labels: { color: TEXTO, font: { size: 11 } } },
        title: { display: true, text: 'Domínio por dia — horas (barra) e conquistas (linha)', color: TEXTO_FRACO, font: { size: 11, weight: 'normal' }, align: 'start' },
      },
      scales: {
        x: {
          ticks: { color: TEXTO_FRACO, maxRotation: 0, autoSkip: true, maxTicksLimit: 12, font: { size: 10 } },
          grid: { color: GRADE },
        },
        horas: {
          position: 'left',
          beginAtZero: true,
          title: { display: true, text: 'horas', color: TEXTO_FRACO, font: { size: 10 } },
          ticks: { color: TEXTO_FRACO, font: { size: 10 } },
          grid: { color: GRADE },
        },
        conquistas: {
          position: 'right',
          beginAtZero: true,
          title: { display: true, text: 'conquistas', color: TEXTO_FRACO, font: { size: 10 } },
          ticks: { color: TEXTO_FRACO, font: { size: 10 }, precision: 0 },
          grid: { drawOnChartArea: false },
        },
      },
    },
  };
  return chartJSNodeCanvas.renderToBuffer(configuration);
}

module.exports = { gerarGraficoTerritoriosPorDia };
