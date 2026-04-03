const { createCanvas, loadImage, registerFont } = require('canvas');
const path = require('path');

const fontsDir = path.join(__dirname, '../fonts');
registerFont(path.join(fontsDir, 'LiberationSans-Regular.ttf'),   { family: 'LiberationSans' });
registerFont(path.join(fontsDir, 'LiberationSans-Bold.ttf'),       { family: 'LiberationSans', weight: 'bold' });
registerFont(path.join(fontsDir, 'LiberationSans-Italic.ttf'),     { family: 'LiberationSans', style: 'italic' });
registerFont(path.join(fontsDir, 'LiberationSans-BoldItalic.ttf'), { family: 'LiberationSans', weight: 'bold', style: 'italic' });

const W = 800;
const H = 490;

// Encaixa a imagem dentro do box sem esticar (contain)
function drawContain(ctx, img, x, y, w, h) {
  const ratio = Math.min(w / img.width, h / img.height);
  const sw = img.width * ratio;
  const sh = img.height * ratio;
  ctx.drawImage(img, x + (w - sw) / 2, y + (h - sh) / 2, sw, sh);
}

// Preenche o box com a imagem sem esticar, cortando o excesso (cover)
function drawCover(ctx, img, x, y, w, h) {
  const ratio = Math.max(w / img.width, h / img.height);
  const sw = img.width * ratio;
  const sh = img.height * ratio;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, x + (w - sw) / 2, y + (h - sh) / 2, sw, sh);
  ctx.restore();
}

async function gerarCarteirinha({ nome, numeroSocio, validade, avatarUrl }) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Tamanho quadrado igual para logo e foto
  const S = 200;    // lado do quadrado
  const imgY = 108;  // topo (bottom = 108+200 = 308, encostado na faixa)

  const logoX = 12;
  const photoX = W - 12 - S; // = 548

  // 1. Fundo branco
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // 2. Faixas decorativas (desenhadas ANTES dos logos)
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 308, W, 12);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 320, W, 8);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 328, W, H - 328);

  // 3. Logo Gaviões — quadrado, contain (sem esticar)
  try {
    const logo = await loadImage(path.join(__dirname, '../img/gavioesdafielfivem_logo.png'));
    drawContain(ctx, logo, logoX, imgY, S, S);
  } catch {}

  // 4. Foto / Avatar — quadrado, cover (preenche sem esticar)
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(photoX - 3, imgY - 3, S + 6, S + 6);
  ctx.strokeStyle = '#cccccc';
  ctx.lineWidth = 2;
  ctx.strokeRect(photoX, imgY, S, S);

  if (avatarUrl) {
    try {
      const avatar = await loadImage(avatarUrl);
      drawCover(ctx, avatar, photoX, imgY, S, S);
    } catch {
      desenharPlaceholderFoto(ctx, photoX, imgY, S, S);
    }
  } else {
    desenharPlaceholderFoto(ctx, photoX, imgY, S, S);
  }

  // 5. Cabeçalho (zona branca)
  ctx.textAlign = 'center';
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 44px LiberationSans';
  ctx.fillText('GAVIÕES DA FIEL TORCIDA', W / 2, 48);

  ctx.font = '14px LiberationSans';
  const subtitulo = 'FORÇA INDEPENDENTE EM PROL DO GRANDE CORINTHIANS';
  const subW = ctx.measureText(subtitulo).width;
  ctx.fillText(subtitulo, W / 2, 66);
  ctx.fillRect((W - subW) / 2, 70, subW, 1.5);

  ctx.font = '14px LiberationSans';
  ctx.textAlign = 'right';
  ctx.fillText('Fundado em 01/07/1969', photoX - 10, 92);

  // 6. Dados
  const dadosX = logoX + S + 14; // 266
  ctx.textAlign = 'left';
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 23px LiberationSans';
  ctx.fillText('Sócio nº:', dadosX, 162);
  ctx.font = '23px LiberationSans';
  ctx.fillText(String(numeroSocio).padStart(4, '0'), dadosX + 130, 162);

  ctx.font = 'bold 23px LiberationSans';
  ctx.fillStyle = '#1a1a1a';
  ctx.fillText('Validade:', dadosX, 218);
  ctx.font = '23px LiberationSans';
  ctx.fillText(validade, dadosX + 130, 218);

  // 7. Assinatura e rodapé — sobre bloco preto
  const assX1 = dadosX;
  const assX2 = photoX - 10;
  const assCX = (assX1 + assX2) / 2;

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = 'italic 22px LiberationSans';
  ctx.fillText('Mano Beiço', assCX, 385);

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(assX1, 400);
  ctx.lineTo(assX2, 400);
  ctx.stroke();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 15px LiberationSans';
  ctx.fillText('Presidente', assCX, 420);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 27px LiberationSans';
  ctx.fillText('Nome:', 30, 466);
  ctx.font = '25px LiberationSans';
  const nomeDisplay = nome.length > 30 ? nome.substring(0, 30) + '...' : nome;
  ctx.fillText(nomeDisplay, 30 + 106, 466);

  // 8. Borda do cartão
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  return canvas.toBuffer('image/png');
}

function desenharPlaceholderFoto(ctx, x, y, w, h) {
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#aaaaaa';
  ctx.font = 'bold 22px LiberationSans';
  ctx.textAlign = 'center';
  ctx.fillText('FOTO', x + w / 2, y + h / 2 + 8);
}

module.exports = { gerarCarteirinha };
