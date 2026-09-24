// Como o servidor Hoolibras nomeia as peças de patrimônio da torcida nos logs.
// Específico desta fonte: outro servidor de jogo teria outro formato (e o
// adapter dele traria a própria versão de nomePatrimonio).

// Bandeira/faixa/mastro/instrumento de bateria da torcida, saindo ou voltando
// pro baú. Dois formatos reais coexistem nos logs do jogo (levantamento de
// 2026-09-15, 21 mil mensagens de logs-baú escaneadas): o webhook novo
// ("Retirou/Guardou <cargo>", ver parser.extrairPatrimonio) já manda nome
// amigável — "GDF Mastro 01", "TOR Faixa 01", "GDF Caixa"; o baú comum antigo
// (parser.extrairBau) só manda o código de spawn cru — "hoolibras_gdf_mastro
// _02". Devolve o RÓTULO pronto pra exibir quando o item é patrimônio de
// verdade, ou null quando não é — sem isso, "GDF Sócio"/"Munição de Pistola"
// (item comum do mesmo baú/formato) virariam alerta de patrimônio também.
const RE_PATRIMONIO_NOVO = /\b(Bandeirinha|Faixa|Longa|Mastro|Quadrada|Tambor|Caixa)\b\s*\d*$/i;
const RE_PATRIMONIO_ANTIGO = /^hoolibras_([a-z]+)_(mastro|quadrada|retangular)_?(\d*)/i;
const TIPOS_PATRIMONIO_ANTIGO = { mastro: 'Mastro', quadrada: 'Bandeira Quadrada', retangular: 'Bandeira Retangular' };

function nomePatrimonio(alvoNome) {
  const nome = String(alvoNome ?? '').trim();
  if (!nome) return null;
  if (RE_PATRIMONIO_NOVO.test(nome)) return nome;
  const m = nome.match(RE_PATRIMONIO_ANTIGO);
  if (!m) return null;
  const tipo = TIPOS_PATRIMONIO_ANTIGO[m[2].toLowerCase()] ?? m[2];
  return `${m[1].toUpperCase()} ${tipo}${m[3] ? ` ${m[3].padStart(2, '0')}` : ''}`;
}

module.exports = { nomePatrimonio };
