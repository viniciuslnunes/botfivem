const config = require('../../config/index.js');
const repo = require('./repositorio');
const E = require('./estatisticas');
const F = require('./painelFormato');
const { criarPainelCanal } = require('./painelCanal');
const { registrarConsulta, selectPeriodo } = require('./painelConsulta');

// Canal 📦・estoque-bau: o que entra e sai do baú da torcida, por compartimento
// (GDF Sócio / Diretoria / Presidência), a partir do canal logs-baú.
//
// Honestidade do número: o jogo NUNCA diz quanto já tinha dentro do baú, só
// avisa "guardou 1 tecido" / "removeu 58 madeira". Então o que este painel
// mostra é SALDO LÍQUIDO DESDE O PRIMEIRO LOG LIDO, não estoque — e diz isso em
// cima, com a data. Saldo negativo não é erro: significa que saiu mais do que
// entrou nesse intervalo (foi consumido do que já estava lá antes).
const SLUG = 'estoque_bau';
const TOP_ITENS = 25;
const TOP_PESSOAS = 10;
const TOP_RETIRADAS = 5;

function qtd(n) {
  return E.formatarNumero(Math.round(Number(n) || 0));
}

// Nome do jogador só existe nos OUTROS canais de log: o do baú manda só o ID.
const comNomes = linhas => F.comNomes(linhas);

function linhaItem(l) {
  const sinal = l.saldo > 0 ? '📈' : l.saldo < 0 ? '📉' : '➖';
  return `${sinal} **${F.nomeSeguro(l.item)}** — saldo **${qtd(l.saldo)}** `
    + `(entrou ${qtd(l.guardou)} · saiu ${qtd(l.removeu)})`;
}

function linhaPessoa(l, i) {
  return `${i + 1}. ${F.pessoa(l)} — retirou **${qtd(l.removeu)}** · guardou ${qtd(l.guardou)}`;
}

function linhaRetirada(l) {
  return `• ${F.pessoa(l)} tirou **${qtd(l.quantidade)}× ${F.nomeSeguro(l.item)}** `
    + `de ${F.nomeSeguro(E.bauDoTitulo(l.titulo) ?? 'baú')} — ${E.formatarDataHora(l.ocorrido_em)}`;
}

// Agrupa o saldo por compartimento: cada baú é um "cofre" diferente, com gente
// diferente autorizada — somar tudo junto escondia justamente o que interessa.
function blocosPorBau(saldos) {
  const porBau = new Map();
  for (const l of saldos) {
    const bau = l.bau ?? 'BAÚ';
    if (!porBau.has(bau)) porBau.set(bau, []);
    porBau.get(bau).push(l);
  }
  return [...porBau.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
}

async function montarBlocos() {
  const [saldos, pessoas, retiradas] = await Promise.all([
    repo.saldoBau(),
    repo.movimentoBauPorPessoa(E.resolverPeriodo('30d'), TOP_PESSOAS).then(comNomes),
    repo.maioresRetiradasBau(E.resolverPeriodo('30d'), TOP_RETIRADAS).then(comNomes),
  ]);

  if (!saldos.length) {
    return F.blocosDeEmbeds(F.embedsDeLista({
      titulo: '📦 BAÚ DA TORCIDA',
      cabecalho: 'Nenhum movimento de baú registrado ainda.',
      linhas: [],
      vazio: 'Assim que o jogo publicar o primeiro "Guardou/Removeu" no canal de logs do baú, ele aparece aqui.',
      origem: 'canal logs-baú',
    }));
  }

  const desde = saldos.reduce((min, l) => (new Date(l.desde) < new Date(min) ? l.desde : min), saldos[0].desde);
  const embeds = [];

  for (const [bau, itens] of blocosPorBau(saldos)) {
    const negativos = itens.filter(l => l.saldo < 0).length;
    embeds.push(...F.embedsDeLista({
      titulo: `📦 BAÚ — ${bau.toUpperCase()}`,
      cabecalho: [
        `**${itens.length}** ${itens.length === 1 ? 'item movimentado' : 'itens movimentados'}`
          + (negativos ? ` · **${negativos}** com saldo negativo (saiu mais do que entrou)` : ''),
        `Saldo **líquido desde ${E.formatarDataHora(desde)}** — não é o estoque: o jogo não informa o que já estava dentro.`,
      ].join('\n'),
      linhas: itens.slice(0, TOP_ITENS).map(linhaItem),
      vazio: 'Sem movimento.',
      origem: 'canal logs-baú',
    }));
  }

  embeds.push(...F.embedsDeLista({
    titulo: '🔎 QUEM MEXEU NO BAÚ — ÚLTIMOS 30 DIAS',
    cabecalho: 'Ordenado por quanto cada um RETIROU (é o lado que gera prejuízo se for indevido).',
    linhas: pessoas.map(linhaPessoa),
    vazio: 'Ninguém mexeu no baú nos últimos 30 dias.',
    origem: 'canal logs-baú',
    fields: retiradas.length
      ? [{ name: `MAIORES RETIRADAS DE UMA VEZ (alerta acima de ${qtd(config.logsJogo.bau.alertaRetiradaQtd)})`, value: E.truncar(retiradas.map(linhaRetirada).join('\n'), 1024) }]
      : [],
  }));

  return F.blocosDeEmbeds(embeds);
}

function montarAcao() {
  return {
    content: '👇 **VER O MOVIMENTO DO BAÚ NUM PERÍODO**',
    components: [selectPeriodo(SLUG, 'ESCOLHA UM PERÍODO')],
  };
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '📦・estoque-bau',
  razao: 'Saldo e auditoria do baú da torcida a partir dos logs do jogo',
  intervaloMin: 30,
  montarBlocos,
  montarAcao,
});

// Consulta por período (ephemeral): movimento e maiores retiradas da janela
// escolhida — o canal em si fala do acumulado, esta responde "e no mês passado?".
registrarConsulta(SLUG, async periodo => {
  const [pessoas, retiradas] = await Promise.all([
    repo.movimentoBauPorPessoa(periodo, TOP_PESSOAS).then(comNomes),
    repo.maioresRetiradasBau(periodo, TOP_RETIRADAS).then(comNomes),
  ]);
  return {
    embeds: F.embedsDeLista({
      titulo: `📦 BAÚ — ${periodo.rotulo}`,
      cabecalho: `Quem mexeu no baú no período, por quantidade retirada.`,
      linhas: pessoas.map(linhaPessoa),
      vazio: 'Ninguém mexeu no baú neste período.',
      origem: 'canal logs-baú',
      fields: retiradas.length
        ? [{ name: 'MAIORES RETIRADAS DO PERÍODO', value: E.truncar(retiradas.map(linhaRetirada).join('\n'), 1024) }]
        : [],
    }).slice(0, 1),
  };
}, painel.agendarAtualizacaoReativa);

module.exports = {
  iniciarPainelBau: painel.iniciar,
  atualizarPainelBau: painel.atualizar,
  agendarAtualizacaoReativa: painel.agendarAtualizacaoReativa,
};
