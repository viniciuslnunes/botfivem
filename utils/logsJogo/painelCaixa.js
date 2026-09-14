const repo = require('./repositorio');
const E = require('./estatisticas');
const F = require('./painelFormato');
const { criarPainelCanal } = require('./painelCanal');
const { linhaComponentesCaixa, DINHEIRO, HONRA, ROUPA, ACOES_TODAS, cabecalhoDinheiro, linhaResumo } = require('./painelCaixaInteracoes');

// Canal 🏦・caixa-do-jogo: dinheiro e honra da torcida a partir dos logs do
// jogo. Mensagem fixa curta (padrão interativo, ver painelBau.js e
// docs/inteligencia-logs-jogo.md § "Padrão de UI") — toda a exploração por
// período, busca de jogador e ranking mora em painelCaixaInteracoes.js.
const SLUG = 'caixa_jogo';

async function montarBlocos() {
  const tudo = E.resolverPeriodo('tudo');
  const [somasTudo, ultima, ultimaRoupa] = await Promise.all([
    repo.somarPorAcoes(ACOES_TODAS, tudo),
    repo.ultimaOcorrencia(DINHEIRO),
    repo.ultimaOcorrencia(ROUPA),
  ]);

  const avisoRoupa = F.avisoFonteParada(ultimaRoupa);
  const embed = {
    color: F.COR,
    title: '🏦 CAIXA DO JOGO — GAVIÕES DA FIEL FIVEM',
    description: cabecalhoDinheiro(somasTudo, 'DESDE O PRIMEIRO LOG LIDO', F.avisoFonteParada(ultima)),
    fields: F.campoLista('MOVIMENTO POR TIPO', somasTudo.map(linhaResumo), 'Nenhum registro de dinheiro ainda.'),
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
