// Regras puras das sugestões de melhoria (sem Discord, sem banco).
const TEXTO_MIN = 10;
const TEXTO_MAX = 1000;

function validarTexto(texto) {
  const t = String(texto ?? '').trim();
  if (t.length < TEXTO_MIN) return { ok: false, mensagem: `❌ DESCREVA A SUGESTÃO COM PELO MENOS ${TEXTO_MIN} CARACTERES.` };
  if (t.length > TEXTO_MAX) return { ok: false, mensagem: `❌ A SUGESTÃO PODE TER NO MÁXIMO ${TEXTO_MAX} CARACTERES.` };
  return { ok: true, texto: t };
}

// Linhas { voto: 'A' | 'C', n } → { aprovo, contra }
function contarVotos(linhas = []) {
  const contagem = { aprovo: 0, contra: 0 };
  for (const l of linhas) {
    if (l.voto === 'A') contagem.aprovo = Number(l.n);
    if (l.voto === 'C') contagem.contra = Number(l.n);
  }
  return contagem;
}

module.exports = { validarTexto, contarVotos, TEXTO_MIN, TEXTO_MAX };
