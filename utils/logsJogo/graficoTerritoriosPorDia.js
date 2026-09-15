const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
require('chart.js/auto');
const E = require('./estatisticas');

// Domínio de territórios por DIA — eixo X = dia, três séries: horas de
// domínio (barra), conquistas totais do dia (linha) e maior disputa por um
// único território no dia (linha tracejada). Chart.js (via
// chartjs-node-canvas) em vez do canvas desenhado à mão que o resto do bot
// usa (graficoOcupacao.js): três séries com eixos Y independentes — pronto,
// testado e legendado — é o caso em que uma lib de gráfico de verdade vale
// mais que reimplementar isso à mão. Continua uma imagem estática (PNG),
// reenviada a cada edição do painel: não existe gráfico "vivo" dentro de um
// embed do Discord.
//
// Histórico: este arquivo existiu, foi removido (outra sessão do Claude Code
// rodando no mesmo repo, 2026-09-15 04:36 — ver git log) e voltou aqui a
// pedido do usuário no mesmo dia, porque a remoção não foi intencional desta
// conversa. Ver nota em painelTerritorio.js sobre sessões concorrentes.

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
// os dois casos.
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
        title: { display: true, text: 'Domínio por dia — horas (barra), conquistas e disputa (linhas)', color: TEXTO_FRACO, font: { size: 11, weight: 'normal' }, align: 'start' },
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
