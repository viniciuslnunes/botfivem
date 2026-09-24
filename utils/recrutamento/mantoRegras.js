// Regras puras do placar de manto (sem Discord, sem banco).

const RESULTADOS = { certo: 'CORRETO', errado: 'ERRADO' };

// % de acerto arredondado; null quando ainda não há foto avaliada
function taxaDeAcerto({ acertos, erros }) {
  const total = acertos + erros;
  return total ? Math.round((acertos / total) * 100) : null;
}

// Junta o placar do banco com a lista de quem tem o cargo de recrutador (quem
// não teve nenhuma foto avaliada aparece zerado). Ordena por mais avaliações e,
// no empate, por maior taxa. Devolve também a linha "sem recrutador".
function montarPlacar(linhasDoBanco, idsRecrutadores) {
  const porId = new Map();
  let semRecrutador = { acertos: 0, erros: 0 };
  for (const l of linhasDoBanco) {
    if (l.recrutador_id) porId.set(l.recrutador_id, { acertos: l.acertos, erros: l.erros });
    else semRecrutador = { acertos: l.acertos, erros: l.erros };
  }
  for (const id of idsRecrutadores) if (!porId.has(id)) porId.set(id, { acertos: 0, erros: 0 });

  const recrutadores = [...porId.entries()]
    .map(([id, v]) => ({ id, ...v, taxa: taxaDeAcerto(v) }))
    .sort((a, b) => (b.acertos + b.erros) - (a.acertos + a.erros) || (b.taxa ?? -1) - (a.taxa ?? -1));
  return { recrutadores, semRecrutador };
}

module.exports = { RESULTADOS, taxaDeAcerto, montarPlacar };
