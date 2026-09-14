const { createCanvas } = require('canvas');

// Ranking de domínio por território em barras horizontais — mesmo padrão de
// imagem gerada (canvas, já dependência do projeto) que o resto do bot usa
// pra visual que texto não resolve bem (ver graficoOcupacao.js,
// gerarCarteirinha.js). Comparar barra com barra é mais rápido que ler
// números alinhados numa tabela em texto (painelFormato.js#tabela, que
// continua existindo pra outros rankings do bot).
//
// Trade-off consciente (mesmo que graficoOcupacao.js já assume pro pico por
// hora/dia): o detalhe por território (posição, horas, conquistas, coins)
// fica só na imagem — não dá pra copiar/buscar texto dentro dela. O resumo
// AGREGADO (total de horas, conquistas, territórios) continua em texto na
// description do embed, então quem só quer o placar geral não depende da
// imagem carregar.
//
// Pedido do usuário em 2026-09-14 ("melhore mais, com as melhores
// ferramentas ou bibliotecas pra este fluxo") — troca a tabela do TOP fixo
// do painel de 🗺️・dominacao-territorios (e do ranking por período) por isto.

const W = 700;
const ALTURA_LINHA = 34;
const MARGEM = { topo: 30, baixo: 14, esquerda: 190, direita: 112 };

// Mesma paleta preto/branco/cinza dos outros gráficos do bot (cores da
// torcida, sem vermelho/amarelo) — só o líder do ranking se destaca em
// branco, o resto fica em cinza.
const COR_FUNDO = '#000000';
const COR_GRADE = '#262626';
const COR_TEXTO = '#FFFFFF';
const COR_TEXTO_FRACO = '#999999';
const COR_BARRA = '#8C8C8C';
const COR_LIDER = '#FFFFFF';

// Corta o nome do território até caber na coluna da esquerda — nome do jogo
// não tem limite de tamanho garantido (ver corrigirMojibake em outros pontos).
function truncarNaLargura(ctx, texto, larguraMax) {
  if (ctx.measureText(texto).width <= larguraMax) return texto;
  let cortado = texto;
  while (cortado.length > 1 && ctx.measureText(`${cortado}…`).width > larguraMax) {
    cortado = cortado.slice(0, -1);
  }
  return `${cortado}…`;
}

// `territorios` = [{ territorio, horas, conquistas, coins }], já ordenado
// (porTerritorio) — desenha exatamente os itens recebidos, na ordem dada;
// quem chama decide quantos (TOP fixo corta em 10, o ranking por período
// manda a página inteira, até 25).
function gerarGraficoTerritorios(territorios) {
  const n = territorios.length || 1;
  const H = MARGEM.topo + MARGEM.baixo + n * ALTURA_LINHA;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = COR_FUNDO;
  ctx.fillRect(0, 0, W, H);

  const areaW = W - MARGEM.esquerda - MARGEM.direita;
  const max = Math.max(1, ...territorios.map(t => t.horas));

  ctx.fillStyle = COR_TEXTO_FRACO;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Domínio por território (horas)', 4, 14);

  territorios.forEach((t, i) => {
    const y = MARGEM.topo + i * ALTURA_LINHA;
    const centroY = y + ALTURA_LINHA / 2;
    const larguraBarra = Math.max(2, (t.horas / max) * areaW);
    const ehLider = i === 0;

    if (i > 0) {
      ctx.strokeStyle = COR_GRADE;
      ctx.beginPath();
      ctx.moveTo(MARGEM.esquerda, y);
      ctx.lineTo(W - MARGEM.direita, y);
      ctx.stroke();
    }

    // "1. Hipódromo" — rank + nome, alinhado à direita colado na barra
    ctx.fillStyle = ehLider ? COR_LIDER : COR_TEXTO;
    ctx.font = ehLider ? 'bold 13px sans-serif' : '13px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const rotulo = truncarNaLargura(ctx, `${i + 1}. ${t.territorio}`, MARGEM.esquerda - 12);
    ctx.fillText(rotulo, MARGEM.esquerda - 12, centroY);

    // Barra proporcional às horas de domínio
    ctx.fillStyle = ehLider ? COR_LIDER : COR_BARRA;
    ctx.fillRect(MARGEM.esquerda, y + 5, larguraBarra, ALTURA_LINHA - 10);

    // Horas no fim da barra + conquistas/coins menor, embaixo
    ctx.fillStyle = ehLider ? COR_LIDER : COR_TEXTO;
    ctx.font = ehLider ? 'bold 12px sans-serif' : '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(t.horas)}h`, MARGEM.esquerda + larguraBarra + 8, centroY - 6);
    ctx.fillStyle = COR_TEXTO_FRACO;
    ctx.font = '10px sans-serif';
    ctx.fillText(`${Math.round(t.conquistas)}x · ${Math.round(t.coins)} coins`, MARGEM.esquerda + larguraBarra + 8, centroY + 8);
  });

  return canvas.toBuffer('image/png');
}

module.exports = { gerarGraficoTerritorios };
