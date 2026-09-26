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
function montarPlacar(linhasDoBanco, idsRecrutadores, motivos = []) {
  const zero = () => ({ acertos: 0, erros: 0, recuperados: 0 });
  const porId = new Map();
  let semRecrutador = zero();
  for (const l of linhasDoBanco) {
    const v = { acertos: l.acertos, erros: l.erros, recuperados: l.recuperados ?? 0 };
    if (l.recrutador_id) porId.set(l.recrutador_id, v);
    else semRecrutador = v;
  }
  for (const id of idsRecrutadores) if (!porId.has(id)) porId.set(id, zero());

  const recrutadores = [...porId.entries()]
    .map(([id, v]) => ({ id, ...v, taxa: taxaDeAcerto(v), motivoTop: motivoMaisFrequente(motivos.filter(m => m.recrutador_id === id)) }))
    .sort((a, b) => (b.acertos + b.erros) - (a.acertos + a.erros) || (b.taxa ?? -1) - (a.taxa ?? -1));
  return { recrutadores, semRecrutador };
}

// { motivo, total } do motivo que mais se repete, ou null
function motivoMaisFrequente(linhas) {
  const top = [...linhas].sort((a, b) => b.total - a.total)[0];
  return top ? { motivo: top.motivo, total: top.total } : null;
}

// ── Situação do candidato (fotos do provar-manto) ───────────────────────────
// fotos: [{ resultado: 'CORRETO'|'ERRADO'|null, motivo, enviado_em }] em ordem de envio.
// Erro RECUPERADO = existe foto CORRETO enviada depois; não conta contra ninguém.
const LIMITES = Object.freeze({
  reincidencia: 2,          // fotos reprovadas (não recuperadas) para virar alerta de reincidência
  prazoCasoHoras: 24,       // caso aberto além disso é lembrado
  lembretesCaso: 3,         // quantas vezes o caso aberto é lembrado
  fotoParadaMin: [30, 120], // minutos sem avaliação em que a liderança é lembrada
});

function resumirFotos(fotos) {
  const efetivos = fotos.filter((f, i) => f.resultado === 'ERRADO' && !fotos.slice(i + 1).some(g => g.resultado === 'CORRETO'));
  const ultima = fotos.at(-1) ?? null;
  return {
    total: fotos.length,
    erradosEfetivos: efetivos.length,
    recuperados: fotos.filter(f => f.resultado === 'ERRADO').length - efetivos.length,
    pendentes: fotos.filter(f => f.resultado == null).length,
    ultima,
    ultimoMotivo: efetivos.at(-1)?.motivo ?? null,
    reincidente: efetivos.length >= LIMITES.reincidencia,
  };
}

// Aviso para quem acaba de APROVAR a ficha; null = manto em ordem, nada a dizer
function avisoAoAprovar(fotos, rotulo = id => id) {
  const r = resumirFotos(fotos);
  if (!r.total) return { nivel: 'sem_foto', texto: 'não há **nenhuma foto de manto** registrada no provar-manto para este candidato.' };
  if (r.ultima.resultado === 'ERRADO') {
    return { nivel: 'errado', texto: `o manto está avaliado como **ERRADO** (${rotulo(r.ultima.motivo)}) e não foi corrigido. Isso **conta como erro seu**.` };
  }
  if (r.ultima.resultado == null) return { nivel: 'pendente', texto: 'o manto ainda **não foi avaliado** pela liderança.' };
  return null;
}

// Motivos do manto errado: os de regrasManto.js (os mesmos que o candidato lê no provar-manto)
const { MOTIVOS_REPROVACAO: MOTIVOS_MANTO } = require('./regrasManto');

const motivoValido = id => MOTIVOS_MANTO.some(m => m.id === id);
const rotuloMotivo = id => MOTIVOS_MANTO.find(m => m.id === id)?.label ?? 'Motivo não catalogado';

// Um canal por motivo, todos com o mesmo prefixo
function nomeCanalCaso(motivoId) {
  return `🧥・manto-${String(motivoId).replace(/_/g, '-')}`;
}

// Nome de arquivo seguro para re-enviar a foto no card (o link do CDN expira)
function nomeArquivoFoto(nome) {
  const limpo = String(nome ?? '').toLowerCase().replace(/[^a-z0-9._-]/g, '');
  return /\.(png|jpe?g|gif|webp)$/.test(limpo) ? limpo : 'manto.png';
}

module.exports = {
  RESULTADOS, taxaDeAcerto, montarPlacar, motivoMaisFrequente, LIMITES, resumirFotos, avisoAoAprovar, MOTIVOS_MANTO, motivoValido, rotuloMotivo, nomeCanalCaso, nomeArquivoFoto,
};
