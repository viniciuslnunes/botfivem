// Fábrica do tema (pura, testável): mescla o que o tenant sobrescreve sobre
// tema/base.js, valida e congela. O tema ATIVO é montado em tema/index.js.
const path = require('path');
const base = require('./base');
const { validarTema } = require('./validacao');

function mesclar(alvo, origem) {
  const saida = { ...alvo };
  for (const [k, v] of Object.entries(origem || {})) {
    saida[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof alvo[k] === 'object' && !Array.isArray(alvo[k])
      ? mesclar(alvo[k], v)
      : v;
  }
  return saida;
}

function congelar(obj) {
  for (const v of Object.values(obj)) if (v && typeof v === 'object') congelar(v);
  return Object.freeze(obj);
}

// Caminhos ('cor.primaria') que o tenant declarou; o resto veio da base.
function declarados(obj, prefixo = '', saida = new Set()) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) declarados(v, `${prefixo}${k}.`, saida);
    else saida.add(`${prefixo}${k}`);
  }
  return saida;
}

// Tokens do tema mesclado que o tenant não declarou (herdados da base).
function herdadosDe(especifico) {
  const dele = declarados(especifico);
  const todos = declarados(base);
  return new Set([...todos].filter(c => !dele.has(c)));
}

// Constrói o tema a partir do que o tenant sobrescreve e da pasta de assets
// dele. Falha na hora (com TODOS os problemas) se o tema for inválido — a
// alternativa seria descobrir cor proibida em produção, num embed.
function criarTema(especifico, { pastaAssets } = {}) {
  const t = mesclar(base, especifico);
  const erros = validarTema(t, { herdados: herdadosDe(especifico) });
  if (erros.length) {
    throw new Error(`Tema inválido:\n - ${erros.join('\n - ')}`);
  }

  // Derivados que dependem da preposição do tenant.
  t.marca = {
    ...t.marca,
    dosNome: `${t.marca.de.toUpperCase()} ${t.marca.nomeSegmentado}`, // "DOS GAVIÕES DA FIEL - FIVEM"
    dosNormal: `${t.marca.de} ${t.marca.nomeNormal} - FiveM`, // "dos Gaviões da Fiel - FiveM"
  };

  const asset = nome => path.join(pastaAssets || '', nome);
  const anexo = nome => ({ attachment: asset(nome), name: nome });

  return congelar({
    ...t,
    // "BAÚ DA TORCIDA — GAVIÕES DA FIEL FIVEM"
    titulo: texto => `${texto} — ${t.marca.nome}`,
    // "TICKET - GAVIÕES DA FIEL - FIVEM"
    tituloSegmentado: texto => `${texto} - ${t.marca.nomeSegmentado}`,
    // Arquivo de imagem do tenant (logo, capa, faixa…) como anexo do Discord.
    asset,
    anexo,
    urlAnexo: nome => `attachment://${nome}`,
    logo: () => anexo(t.marca.logo),
    urlLogo: () => `attachment://${t.marca.logo}`,
  });
}

module.exports = { criarTema };
