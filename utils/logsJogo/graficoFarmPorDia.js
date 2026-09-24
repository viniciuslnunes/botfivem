const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
require('chart.js/auto');
const E = require('./estatisticas');
const tema = require('../../tema');

// Volume farmado por DIA — uma série só (quantidade guardada de item de
// farm), bem mais simples que graficoTerritoriosPorDia (3 séries, 2 eixos):
// aqui não tem "disputa" nem eixo secundário, só tendência de produção no
// tempo. Mesma lib (chartjs-node-canvas) e paleta preto/branco/cinza da
// torcida, ver docs/padroes-e-canais.md § 1.9.

const W = 700;
const H = 260;
const FUNDO = tema.imagem.fundo;
const GRADE = tema.imagem.grade;
const TEXTO_FRACO = tema.imagem.textoFraco;
const COR_BARRA = tema.imagem.barra;

const chartJSNodeCanvas = new ChartJSNodeCanvas({ width: W, height: H, backgroundColour: FUNDO });

// `serie` = [{ dia: 'YYYY-MM-DD', total }], contínua (zero-fill) e em ordem
// cronológica — mesmo shape que estatisticas.js#serieDiaria devolve a
// partir de repositorio.farmPorDia.
function gerarGraficoFarmPorDia(serie) {
  const muitosDias = serie.length > 45;
  const configuration = {
    type: 'bar',
    data: {
      labels: serie.map(s => E.formatarDiaCurto(s.dia)),
      datasets: [{
        label: 'Guardado no baú (unid.)',
        data: serie.map(s => s.total),
        backgroundColor: COR_BARRA,
      }],
    },
    options: {
      layout: { padding: 8 },
      plugins: {
        legend: { display: false },
        title: {
          display: true, text: 'Volume farmado por dia', color: TEXTO_FRACO, font: { size: 11, weight: 'normal' }, align: 'start',
        },
      },
      scales: {
        x: {
          ticks: {
            color: TEXTO_FRACO, maxRotation: 0, autoSkip: true, maxTicksLimit: muitosDias ? 12 : 20, font: { size: 10 },
          },
          grid: { color: GRADE },
        },
        y: {
          beginAtZero: true,
          ticks: { color: TEXTO_FRACO, font: { size: 10 }, precision: 0 },
          grid: { color: GRADE },
        },
      },
    },
  };
  return chartJSNodeCanvas.renderToBuffer(configuration);
}

module.exports = { gerarGraficoFarmPorDia };
