// Correlação de nomes de jogador (o ID do jogo troca a cada season; o nome é a identidade).
// Extraído de logsJogo/idsSemSocio para ser reaproveitado por quem cruza pessoas.

// Nick do Discord no padrão "<prefixo> | Nome - 1234" (ver formatarNick.js):
// pega só o "Nome" do meio, sem o prefixo de cargo nem o ID no fim, pra
// comparar com o nome cru que vem do log do jogo.
function nomeDoNick(nick) {
  const semId = String(nick ?? '').replace(/\s*-\s*\d{1,8}\s*$/, '');
  const semPrefixo = semId.includes('|') ? semId.slice(semId.lastIndexOf('|') + 1) : semId;
  return semPrefixo.trim();
}

function normalizarNome(str) {
  return String(str ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // acentos
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Distância de Levenshtein básica — strings curtas (nomes de jogador), sem
// necessidade de biblioteca externa.
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let anterior = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const linha = [i];
    for (let j = 1; j <= n; j++) {
      linha[j] = a[i - 1] === b[j - 1]
        ? anterior[j - 1]
        : 1 + Math.min(anterior[j - 1], anterior[j], linha[j - 1]);
    }
    anterior = linha;
  }
  return anterior[n];
}

function similaridadeBruta(a, b) {
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

// Comparação em duas passadas: com espaço (pega nome/sobrenome fora de
// ordem) e sem espaço (neutraliza "L.H.P." virando "l h p" contra "Lhp" —
// mesmo apelido, pontuação diferente). Fica com a maior das duas, já que
// qualquer uma bater é sinal forte de ser o mesmo nome.
function similaridade(a, b) {
  return Math.max(similaridadeBruta(a, b), similaridadeBruta(a.replace(/ /g, ''), b.replace(/ /g, '')));
}

module.exports = { nomeDoNick, normalizarNome, levenshtein, similaridade };
