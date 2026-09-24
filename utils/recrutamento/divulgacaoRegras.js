// Regras puras da sequência de divulgações de recrutamento (sem Discord, sem banco).

// posts: mais recente primeiro, [{ autor_id, postado_em }]. Devolve a linha do
// tempo já com o intervalo até o post anterior (o mais antigo da lista não tem).
function montarSequencia(posts) {
  return posts.map((p, i) => {
    const anterior = posts[i + 1];
    return {
      autorId: p.autor_id,
      postadoEm: new Date(p.postado_em),
      intervaloMs: anterior ? new Date(p.postado_em) - new Date(anterior.postado_em) : null,
    };
  });
}

// Contagem de posts por autor dentro da lista informada.
function contarPorAutor(posts) {
  const total = new Map();
  for (const p of posts) total.set(p.autor_id, (total.get(p.autor_id) ?? 0) + 1);
  return total;
}

// Rodízio: o próximo da vez é quem com liberação de postar está há mais tempo sem
// postar (quem nunca postou vem primeiro). O último a postar nunca é o próximo.
// Alertas: mesma pessoa postando duas vezes seguidas e liberados sem postar há
// mais de `diasSumido` dias (ou nunca).
function analisarRodizio({ liberados, posts, agora = new Date(), diasSumido = 7 }) {
  const ultimoPost = new Map();
  for (const p of posts) if (!ultimoPost.has(p.autor_id)) ultimoPost.set(p.autor_id, new Date(p.postado_em));

  const ordem = [...liberados].sort((a, b) => {
    const ta = ultimoPost.get(a)?.getTime() ?? -Infinity;
    const tb = ultimoPost.get(b)?.getTime() ?? -Infinity;
    return ta - tb;
  });
  const ultimoAutor = posts[0]?.autor_id ?? null;
  const proximo = ordem.find(id => id !== ultimoAutor) ?? null;

  const repetiuSeguido = posts.length >= 2 && posts[0].autor_id === posts[1].autor_id ? posts[0].autor_id : null;
  const limite = new Date(agora).getTime() - diasSumido * 24 * 60 * 60 * 1000;
  const sumidos = ordem.filter(id => (ultimoPost.get(id)?.getTime() ?? -Infinity) < limite);

  return { ordem, proximo, ultimoAutor, repetiuSeguido, sumidos, ultimoPost };
}

// Autor postou por conta própria sem ter a liberação de postar: o Discord já
// bloqueia, então isto só acusa mudança de permissão ou post antigo.
function semLiberacao(posts, liberados) {
  const ok = new Set(liberados);
  return [...new Set(posts.map(p => p.autor_id))].filter(id => !ok.has(id));
}

module.exports = { montarSequencia, contarPorAutor, analisarRodizio, semLiberacao };
