// Descobre, pelo NOME, o que a torcida já tem no servidor para cada cargo,
// canal e categoria que o bot precisa. Puro: recebe uma visão simples do
// servidor ({ roles, channels }) e devolve sugestões — quem grava é a pessoa,
// no tenant.js, depois de conferir.
const { CARGOS, CARGOS_EM_LISTA, CANAIS, CATEGORIAS, normalizar } = require('./catalogo');

const NOMES_DE_CANAL_TEXTO = new Set([0, 5, 'GuildText', 'GuildAnnouncement']); // GuildText, GuildAnnouncement
const TIPOS_CATEGORIA = new Set([4, 'GuildCategory']);

// Pontuação do casamento de um nome com os apelidos de uma chave. 0 = não casa.
//  100 nome igual a um apelido · 60 começa/termina com o apelido como palavra
//  inteira · 40 contém o apelido como palavra inteira.
function pontuar(nomeNormalizado, apelidos) {
  let melhor = 0;
  for (const a of apelidos.map(normalizar)) {
    if (!a) continue;
    if (nomeNormalizado === a) melhor = Math.max(melhor, 100);
    else if (nomeNormalizado.startsWith(`${a} `) || nomeNormalizado.endsWith(` ${a}`)) melhor = Math.max(melhor, 60);
    else if (` ${nomeNormalizado} `.includes(` ${a} `)) melhor = Math.max(melhor, 40);
  }
  return melhor;
}

// candidatos: [{ id, name }]. Devolve { id } quando há um vencedor único,
// { ambiguo: [nomes] } quando há empate no topo, ou null quando nada casa.
function melhorCandidato(candidatos, apelidos, jaUsados) {
  const pontuados = candidatos
    .filter(c => !jaUsados.has(c.id))
    .map(c => ({ c, pontos: pontuar(normalizar(c.name), apelidos) }))
    .filter(x => x.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos);
  if (!pontuados.length) return null;
  const topo = pontuados.filter(x => x.pontos === pontuados[0].pontos);
  if (topo.length > 1) return { ambiguo: topo.map(x => x.c.name) };
  return { id: topo[0].c.id };
}

// Chaves pedidas: { cargos: ['socio', ...], cargosEmLista: { adv: 3 }, canais: [...], categorias: [...] }
function sugerirMapeamento(servidor, pedidas) {
  const roles = servidor.roles ?? [];
  const canais = (servidor.channels ?? []).filter(c => NOMES_DE_CANAL_TEXTO.has(c.type));
  const categorias = (servidor.channels ?? []).filter(c => TIPOS_CATEGORIA.has(c.type));
  const usados = new Set(); // um cargo/canal não é sugerido para duas chaves

  const resultado = { cargos: {}, canais: {}, categorias: {}, ambiguos: [], semCorrespondencia: [] };

  const resolver = (grupo, chave, lista, apelidos) => {
    const r = melhorCandidato(lista, apelidos, usados);
    if (!r) resultado.semCorrespondencia.push(`${grupo}.${chave}`);
    else if (r.ambiguo) resultado.ambiguos.push({ chave: `${grupo}.${chave}`, opcoes: r.ambiguo });
    else { resultado[grupo][chave] = r.id; usados.add(r.id); }
  };

  for (const k of pedidas.cargos ?? []) resolver('cargos', k, roles, CARGOS[k]?.apelidos ?? [k]);
  for (const k of pedidas.canais ?? []) resolver('canais', k, canais, CANAIS[k]?.apelidos ?? [k]);
  for (const k of pedidas.categorias ?? []) resolver('categorias', k, categorias, CATEGORIAS[k]?.apelidos ?? [k]);

  for (const [k, qtd] of Object.entries(pedidas.cargosEmLista ?? {})) {
    const def = CARGOS_EM_LISTA[k];
    const ids = [];
    for (let n = 1; n <= qtd; n++) {
      const r = melhorCandidato(roles, def ? def.apelidos(n) : [`${k} ${n}`], usados);
      if (!r) resultado.semCorrespondencia.push(`cargos.${k}[${n}]`);
      else if (r.ambiguo) resultado.ambiguos.push({ chave: `cargos.${k}[${n}]`, opcoes: r.ambiguo });
      else { ids.push(r.id); usados.add(r.id); }
    }
    if (ids.length === qtd) resultado.cargos[k] = ids;
  }
  return resultado;
}

// Dado o que os módulos LIGADOS exigem (manifesto.exige) e o que o tenant já
// tem, devolve só as chaves que faltam.
function chavesFaltando(modulos, tenant) {
  const faltando = { cargos: new Set(), canais: new Set(), categorias: new Set(), cargosEmLista: {} };
  const vazio = v => (Array.isArray(v) ? v.length === 0 : !v);

  // Cargos que qualquer torcida precisa (mesma lista de config/schema.js)
  for (const k of ['socio', 'presidente', 'vicePresidente', 'velhaGuarda', 'diretoria', 'recrutador', 'visitante', 'provarManto', 'reprovadoRecrutamento']) {
    if (vazio(tenant.cargos?.[k])) faltando.cargos.add(k);
  }
  if (vazio(tenant.cargos?.adv) || tenant.cargos.adv.length !== 3) faltando.cargosEmLista.adv = 3;

  for (const m of modulos) {
    const exige = m.exige ?? {};
    for (const k of exige.cargos ?? []) {
      if (k === 'adv') { if (vazio(tenant.cargos?.adv) || tenant.cargos.adv.length !== 3) faltando.cargosEmLista.adv = 3; }
      else if (vazio(tenant.cargos?.[k])) faltando.cargos.add(k);
    }
    for (const k of exige.canais ?? []) if (vazio(tenant.canais?.[k])) faltando.canais.add(k);
    for (const k of exige.categorias ?? []) if (vazio(tenant.categorias?.[k])) faltando.categorias.add(k);
  }
  return {
    cargos: [...faltando.cargos], canais: [...faltando.canais], categorias: [...faltando.categorias],
    cargosEmLista: faltando.cargosEmLista,
  };
}

module.exports = { sugerirMapeamento, chavesFaltando, pontuar, normalizar };
