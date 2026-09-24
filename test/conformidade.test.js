// Guardião: cor, emoji de estado, marca, ID e caminho de asset só podem
// DIMINUIR em relação ao baseline. Regra nova de código não pode reintroduzir
// o que já foi migrado para o tema/tenant.
//
// Depois de migrar arquivos (o número caiu), regrave o baseline:
//   npm run conformidade:atualizar
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REGRAS, contar, comparar, semComentarios } = require('../tools/conformidade');

const BASELINE = path.join(__dirname, 'conformidade.baseline.json');

test('conformidade: nenhuma violação nova em relação ao baseline', () => {
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const { pioraram } = comparar(contar(), baseline);
  const linhas = pioraram.map(p => `  [${p.regra}] ${p.arquivo}: ${p.de} → ${p.para} (${REGRAS[p.regra].descricao})`);
  assert.equal(pioraram.length, 0, `violações novas:\n${linhas.join('\n')}\nUse tema/tenant em vez de literal.`);
});

test('conformidade: ganho precisa ser travado no baseline', () => {
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const { melhoraram } = comparar(contar(), baseline);
  const linhas = melhoraram.map(m => `  [${m.regra}] ${m.arquivo}: ${m.de} → ${m.para}`);
  assert.equal(melhoraram.length, 0, `baseline desatualizado (melhorou):\n${linhas.join('\n')}\nRode: npm run conformidade:atualizar`);
});

// Testes do próprio detector: sem isso, uma regex quebrada "passa" contando zero.
test('detector: pega cada tipo de violação e ignora comentário', () => {
  const casos = {
    cor: ['const c = 0xFF00AA;', "fill('#1a1a1a')", "ctx.fillStyle = 'rgba(255,255,255,0.9)'", 'body { color: #fff; }', 'x { border-left: 4px solid; background:#2b2 }'],
    emojiEstado: ["'✅ ok'", "'🟢'"],
    marca: ["'GAVIÕES DA FIEL'", "'S GDF | '", "'hoolibras_x'", "'R.S.J'", "'paixão pelo Corinthians'", "'A FIEL é gigante'", "'https://linktr.ee/x'", "'https://discord.gg/abc'"],
    idDiscord: ["const x = '1198743169030951004';"],
    caminhoAsset: ["path.join(__dirname, '../img/logo.png')", "'./img/x.jpg'"],
  };
  for (const [regra, amostras] of Object.entries(casos)) {
    for (const a of amostras) {
      assert.ok(semComentarios(a).match(REGRAS[regra].regex), `${regra} deveria pegar: ${a}`);
    }
  }
  const comentario = '// 0xFF0000 GAVIÕES ✅ 1198743169030951004 img/x.png\n/* #000000 GDF */';
  for (const [regra, r] of Object.entries(REGRAS)) {
    assert.equal((semComentarios(comentario).match(r.regex) || []).length, 0, `${regra} não deve contar comentário`);
  }
});

test('detector: não confunde ID de jogador (#15277) nem palavras comuns com violação', () => {
  const texto = "log '#15277 Fulano recrutou #19465', Reserva #123, 'rifa' e (Presidente) ";
  assert.equal((texto.match(REGRAS.cor.regex) || []).length, 0);
  assert.equal((texto.match(REGRAS.marca.regex) || []).length, 0);
});
