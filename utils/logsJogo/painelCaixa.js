const repo = require('./repositorio');
const E = require('./estatisticas');
const F = require('./painelFormato');
const { criarPainelCanal } = require('./painelCanal');
const {
  linhaComponentesCaixa, DINHEIRO, HONRA, ROUPA, ACOES_TODAS, cabecalhoDinheiro, linhaResumo, linhaPessoaValor,
  lerManualCaixa,
} = require('./painelCaixaInteracoes');

// Canal 🏦・caixa-do-jogo: dinheiro e honra da torcida a partir dos logs do
// jogo. Mensagem fixa curta (padrão interativo, ver painelBau.js e
// docs/inteligencia-logs-jogo.md § "Padrão de UI") — toda a exploração por
// período, busca de jogador e ranking mora em painelCaixaInteracoes.js.
const SLUG = 'caixa_jogo';

// TOP depositantes direto na mensagem sempre visível — pedido do usuário em
// 2026-09-15: "quem mais depositou" só aparecia clicando em RANKING/período
// (resposta ephemeral). Mesmo tratamento do TOP de territórios
// (painelTerritorio.js): como este painel já reage sozinho a log novo
// (agendarAtualizacaoReativa, categoria 'economia' — ver events/messageCreate.js),
// o TOP fixo atualiza na hora sem precisar clicar em nada; RANKING continua
// só pra ver outro período ou passar dos 10 primeiros.
const TOP_DEPOSITANTES = 10;

async function montarBlocos() {
  const tudo = E.resolverPeriodo('tudo');
  const [somasTudo, ultima, ultimaRoupa, manual, topDeposito] = await Promise.all([
    repo.somarPorAcoes(ACOES_TODAS, tudo),
    repo.ultimaOcorrencia(DINHEIRO),
    repo.ultimaOcorrencia(ROUPA),
    lerManualCaixa(),
    repo.topAtoresPorValor(['banco_depositou'], tudo, TOP_DEPOSITANTES).then(F.comNomes),
  ]);

  const avisoRoupa = F.avisoFonteParada(ultimaRoupa);
  const embed = {
    color: F.COR,
    title: '🏦 CAIXA DO JOGO — GAVIÕES DA FIEL FIVEM',
    description: cabecalhoDinheiro(somasTudo, 'DESDE O PRIMEIRO LOG LIDO', F.avisoFonteParada(ultima), manual.saldo),
    fields: [
      ...F.campoLista('MOVIMENTO POR TIPO', somasTudo.map(linhaResumo), 'Nenhum registro de dinheiro ainda.'),
      ...(topDeposito.length ? F.campoLista(`TOP ${topDeposito.length} DEPOSITANTES`, topDeposito.map(linhaPessoaValor), '') : []),
    ],
    footer: {
      text: `${F.rodape('canal logs-banco')}`
        + (avisoRoupa && somasTudo.some(l => ROUPA.includes(l.acao)) ? ' · roupa sem log recente (fonte parada)' : ''),
    },
    timestamp: new Date().toISOString(),
  };
  return [{ embeds: [embed], components: linhaComponentesCaixa(), allowedMentions: { parse: [] } }];
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '🏦・caixa-do-jogo',
  razao: 'Dinheiro e honra da torcida a partir dos logs do jogo',
  intervaloMin: 60,
  montarBlocos,
});

module.exports = {
  iniciarPainelCaixa: painel.iniciar,
  atualizarPainelCaixa: painel.atualizar,
  agendarAtualizacaoReativa: painel.agendarAtualizacaoReativa,
};
