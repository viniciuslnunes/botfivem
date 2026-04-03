const { createCanvas, loadImage } = require('canvas');
const path = require('path');

const W = 856;
const H = 540;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

async function gerarCarteirinha({ nome, numeroSocio, validade, avatarUrl }) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // ── Cabeçalho branco ──────────────────────────────────────────────────────
  const headerH = 110;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, headerH);

  ctx.fillStyle = '#111111';
  ctx.textAlign = 'center';
  ctx.font = 'bold 36px Arial';
  ctx.fillText('GAVIÕES DA FIEL TORCIDA', W / 2, 46);

  ctx.font = '15px Arial';
  ctx.fillText('FORÇA INDEPENDENTE EM PROL DO GRANDE CORINTHIANS', W / 2, 74);

  ctx.font = '14px Arial';
  ctx.fillText('Fundado em 01/07/1969', W / 2, 98);

  // ── Faixa vermelha ────────────────────────────────────────────────────────
  ctx.fillStyle = '#CC0000';
  ctx.fillRect(0, headerH, W, 5);

  // ── Body preto ────────────────────────────────────────────────────────────
  const bodyY = headerH + 5;
  const bodyH = H - bodyY;
  ctx.fillStyle = '#111111';
  ctx.fillRect(0, bodyY, W, bodyH);

  // ── Logo Gaviões (esquerda) ───────────────────────────────────────────────
  const logoSize = 168;
  const logoX = 16;
  const logoY = bodyY + 10;
  try {
    const logo = await loadImage(path.join(__dirname, '../img/gavioesdafielfivem_logo.png'));
    ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
  } catch {}

  // ── Foto/Avatar (direita) ────────────────────────────────────────────────
  const fotoW = logoSize;
  const fotoH = logoSize;
  const fotoX = W - fotoW - 16;
  const fotoY = logoY;

  if (avatarUrl) {
    try {
      const avatar = await loadImage(avatarUrl);
      ctx.save();
      roundRect(ctx, fotoX, fotoY, fotoW, fotoH, 4);
      ctx.clip();
      ctx.drawImage(avatar, fotoX, fotoY, fotoW, fotoH);
      ctx.restore();
    } catch {
      desenharPlaceholderFoto(ctx, fotoX, fotoY, fotoW, fotoH);
    }
  } else {
    desenharPlaceholderFoto(ctx, fotoX, fotoY, fotoW, fotoH);
  }

  // ── Campos Sócio nº e Validade ────────────────────────────────────────────
  const campoX = logoX + logoSize + 28;
  const labelW = 118;

  const linha1Y = bodyY + 68;
  const linha2Y = bodyY + 130;

  ctx.textAlign = 'left';

  ctx.font = 'bold 26px Arial';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('Sócio nº:', campoX, linha1Y);
  ctx.font = '26px Arial';
  ctx.fillStyle = '#CCCCCC';
  ctx.fillText(String(numeroSocio).padStart(4, '0'), campoX + labelW, linha1Y);

  ctx.font = 'bold 26px Arial';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('Validade:', campoX, linha2Y);
  ctx.font = '26px Arial';
  ctx.fillStyle = '#CCCCCC';
  ctx.fillText(validade, campoX + labelW, linha2Y);

  // ── Assinatura (centro do body, abaixo dos campos) ────────────────────────
  const assAreaX = campoX;
  const assAreaXEnd = fotoX - 20;
  const assCX = (assAreaX + assAreaXEnd) / 2;
  const assLinhaY = bodyY + 295;

  // Linha da assinatura
  ctx.strokeStyle = '#555555';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(assAreaX + 10, assLinhaY);
  ctx.lineTo(assAreaXEnd - 10, assLinhaY);
  ctx.stroke();

  ctx.fillStyle = '#CCCCCC';
  ctx.font = 'italic 20px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('Mano Beiço', assCX, assLinhaY - 8);

  ctx.fillStyle = '#888888';
  ctx.font = '15px Arial';
  ctx.fillText('Presidente', assCX, assLinhaY + 22);

  // ── Separador do rodapé ───────────────────────────────────────────────────
  const sepY = H - 58;
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, sepY);
  ctx.lineTo(W, sepY);
  ctx.stroke();

  // ── Rodapé nome ───────────────────────────────────────────────────────────
  const nomeY = H - 22;
  ctx.textAlign = 'left';
  ctx.font = 'bold 24px Arial';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('Nome:', 18, nomeY);

  ctx.font = '23px Arial';
  ctx.fillStyle = '#DDDDDD';
  const nomeDisplay = nome.length > 38 ? nome.substring(0, 38) + '...' : nome;
  ctx.fillText(nomeDisplay, 112, nomeY);

  return canvas.toBuffer('image/png');
}

function desenharPlaceholderFoto(ctx, x, y, w, h) {
  ctx.fillStyle = '#2a2a2a';
  roundRect(ctx, x, y, w, h, 4);
  ctx.fill();
  ctx.strokeStyle = '#666666';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 4);
  ctx.stroke();
  ctx.fillStyle = '#666666';
  ctx.font = 'bold 20px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('FOTO', x + w / 2, y + h / 2 + 8);
}

module.exports = { gerarCarteirinha };
