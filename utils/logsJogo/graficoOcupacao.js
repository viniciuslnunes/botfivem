const { createCanvas } = require('canvas');

// Gráfico de barras da variação de pico de simultâneos por hora/dia — o
// sparkline em texto (▁▂▃▄▅▆▇█) fica ilegível quando cada barra é 1 caractere
// só: dá pra ver a "forma" mas não pra saber a QUE hora corresponde cada
// barra. Esse gráfico troca isso por uma imagem com eixo de horas/dias
// rotulado, no mesmo padrão de imagem gerada (canvas) do resto do bot — ver
// gerarCarteirinha.js.

const W = 700;
const H = 280;
const MARGEM = { topo: 34, baixo: 40, esquerda: 44, direita: 16 };

// Paleta preto e branco — cores da torcida (Gaviões da Fiel), sem vermelho/
// amarelo: fundo preto, cinza pras barras normais, branco só destacando o
// maior pico do período.
const COR_FUNDO = '#000000';
const COR_GRADE = '#333333';
const COR_TEXTO = '#FFFFFF';
const COR_TEXTO_FRACO = '#999999';
const COR_BARRA = '#8C8C8C';
const COR_BARRA_ZERO = '#3A3A3A';
const COR_PICO = '#FFFFFF'; // destaca a barra do maior pico do período
const COR_MEDIA = '#7A7A7A';
const COR_AGORA = '#FFFFFF';

// Rótulo curto de cada balde pro eixo X: "HH:MM YYYY-MM-DD HHh" -> "HHh",
// "YYYY-MM-DD" -> "DD/MM". Mantém puro (sem depender de estatisticas.js) pra
// aceitar tanto chave de hora quanto de dia.
function rotuloDoBalde(chave) {
  const partesHora = String(chave).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2})h$/);
  if (partesHora) return `${partesHora[4]}h`;
  const partesDia = String(chave).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (partesDia) return `${partesDia[3]}/${partesDia[2]}`;
  return String(chave);
}

// Evita amontoar rótulos quando tem muito balde (ex.: 30 dias) — mostra só
// uns 10-12 espalhados, sempre incluindo o primeiro e o último.
function indicesDosRotulos(total, maxRotulos = 12) {
  if (total <= maxRotulos) return new Set(Array.from({ length: total }, (_, i) => i));
  const passo = Math.ceil(total / maxRotulos);
  const indices = [];
  for (let i = 0; i < total; i += passo) indices.push(i);
  // Sempre inclui o último balde — mas se o passo já deixou um rótulo
  // muito perto dele, troca em vez de adicionar (senão os dois colam,
  // ex.: "29/03" e "30/03" sobrepostos no canto direito).
  const ultimo = total - 1;
  if (indices[indices.length - 1] === ultimo) return new Set(indices);
  if (ultimo - indices[indices.length - 1] < passo / 2) indices.pop();
  indices.push(ultimo);
  return new Set(indices);
}

// Índice do PRIMEIRO balde que bate o máximo — com empate, destaca só um
// (o mais antigo), senão duas barras "piscando" amarelo no mesmo gráfico
// pareceria bug em vez de dois picos iguais de verdade.
function indiceDoPico(baldes) {
  let idx = -1;
  let max = -1;
  baldes.forEach((b, i) => {
    if (b.pico > max) { max = b.pico; idx = i; }
  });
  return idx;
}

// `baldes` = [{ chave, pico }] na ordem cronológica (ver P.serieDeOcupacao).
// `unidade` só entra no título do eixo ("por hora"/"por dia").
// `opcoes.chaveAtual` = chave do balde que contém o instante presente (só
// quando o período consultado inclui o presente — ver montarDadosPresenca) —
// desenha uma linha vertical marcando "estamos aqui". Períodos fechados
// (ontem, semana/mês passados) não mandam isso.
function gerarGraficoOcupacao(baldes, unidade, opcoes = {}) {
  const { chaveAtual = null } = opcoes;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = COR_FUNDO;
  ctx.fillRect(0, 0, W, H);

  const areaW = W - MARGEM.esquerda - MARGEM.direita;
  const areaH = H - MARGEM.topo - MARGEM.baixo;
  const max = Math.max(1, ...baldes.map(b => b.pico));
  const n = baldes.length || 1;
  const larguraTotal = areaW / n;
  const media = baldes.reduce((soma, b) => soma + b.pico, 0) / n;
  const idxPico = indiceDoPico(baldes);
  const idxAgora = chaveAtual != null ? baldes.findIndex(b => b.chave === chaveAtual) : -1;
  // Só escreve o valor em cima de toda barra quando não são muitas — com
  // 90 baldes (período de 90 dias) os números se sobrepõem e viram ruído;
  // aí só o pico (destacado) ganha o número.
  const mostrarTodosValores = n <= 31;

  // Grade horizontal + rótulos do eixo Y (0, metade, máximo)
  ctx.strokeStyle = COR_GRADE;
  ctx.fillStyle = COR_TEXTO;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  [0, 0.5, 1].forEach(f => {
    const y = MARGEM.topo + areaH * (1 - f);
    ctx.beginPath();
    ctx.moveTo(MARGEM.esquerda, y);
    ctx.lineTo(W - MARGEM.direita, y);
    ctx.stroke();
    ctx.fillText(String(Math.round(max * f)), MARGEM.esquerda - 8, y);
  });

  // Linha tracejada da média do período, pra comparar cada barra contra ela
  if (media > 0) {
    const yMedia = MARGEM.topo + areaH - (media / max) * areaH;
    ctx.save();
    ctx.strokeStyle = COR_MEDIA;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(MARGEM.esquerda, yMedia);
    ctx.lineTo(W - MARGEM.direita, yMedia);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = COR_MEDIA;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`média ${media < 10 ? media.toFixed(1) : Math.round(media)}`, MARGEM.esquerda + 2, yMedia - 2);
  }

  // Barras — a do maior pico do período em amarelo, o resto em vermelho
  // (ou cinza quando zerada)
  baldes.forEach((b, i) => {
    const x = MARGEM.esquerda + i * larguraTotal + (larguraTotal - Math.max(1, larguraTotal * 0.7)) / 2;
    const larguraBarra = Math.max(1, larguraTotal * 0.7);
    const alturaBarra = (b.pico / max) * areaH;
    const y = MARGEM.topo + areaH - alturaBarra;
    ctx.fillStyle = b.pico === 0 ? COR_BARRA_ZERO : (i === idxPico ? COR_PICO : COR_BARRA);
    ctx.fillRect(x, b.pico > 0 ? y : MARGEM.topo + areaH - 1, larguraBarra, b.pico > 0 ? alturaBarra : 1);

    if (b.pico > 0 && (mostrarTodosValores || i === idxPico)) {
      ctx.fillStyle = i === idxPico ? COR_PICO : COR_TEXTO_FRACO;
      ctx.font = i === idxPico ? 'bold 11px sans-serif' : '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(String(b.pico), x + larguraBarra / 2, y - 3);
    }
  });

  // Linha vertical marcando "agora", por cima das barras
  if (idxAgora >= 0) {
    const x = MARGEM.esquerda + idxAgora * larguraTotal + larguraTotal / 2;
    ctx.save();
    ctx.strokeStyle = COR_AGORA;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(x, MARGEM.topo - 8);
    ctx.lineTo(x, MARGEM.topo + areaH);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = COR_AGORA;
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('AGORA', x, MARGEM.topo - 10);
  }

  // Rótulos do eixo X (horas ou dias), espalhados pra não sobrepor
  ctx.fillStyle = COR_TEXTO;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const indices = indicesDosRotulos(n);
  indices.forEach(i => {
    const x = MARGEM.esquerda + i * larguraTotal + larguraTotal / 2;
    ctx.fillText(rotuloDoBalde(baldes[i].chave), x, MARGEM.topo + areaH + 8);
  });

  ctx.fillStyle = COR_TEXTO_FRACO;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`Pico de simultâneos, variação ${unidade}`, 4, 12);

  return canvas.toBuffer('image/png');
}

module.exports = { gerarGraficoOcupacao };
