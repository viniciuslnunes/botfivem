const repo = require('./repositorio');
const E = require('./estatisticas');
const F = require('./painelFormato');
const { criarPainelCanal } = require('./painelCanal');
const {
  linhaComponentesCaixa, DINHEIRO, HONRA, ROUPA, ACOES_TODAS, linhaResumo, lerManualCaixa,
} = require('./painelCaixaInteracoes');

// Canal 🏦・caixa-do-jogo: dinheiro e honra da torcida a partir dos logs do
// jogo. Mensagem fixa curta (padrão interativo, ver painelBau.js e
// docs/inteligencia-logs-jogo.md § "Padrão de UI") — toda a exploração por
// período, busca de jogador e ranking mora em painelCaixaInteracoes.js.
const SLUG = 'caixa_jogo';

// Tela inicial enxuta (pedido do usuário em 2026-09-15, revendo o que
// tínhamos posto no mesmo dia): só o SALDO batido à mão (o número que
// importa de cara) + MOVIMENTO POR TIPO. Entrou/Saiu/Líquido e o aviso
// "não é o saldo da conta" (cabecalhoDinheiro, ainda usado no período/
// ranking — ver painelCaixaInteracoes.js) saíram daqui: é detalhe pra quem
// abre um período, não pra primeira vista. TOP DEPOSITANTES também saiu —
// mora só no RANKING agora (embedRanking), não decide nada por só olhar.
async function montarBlocos() {
  const tudo = E.resolverPeriodo('tudo');
  const [somasTudo, ultima, ultimaRoupa, manual] = await Promise.all([
    repo.somarPorAcoes(ACOES_TODAS, tudo),
    repo.ultimaOcorrencia(DINHEIRO),
    repo.ultimaOcorrencia(ROUPA),
    lerManualCaixa(),
  ]);

  const avisoRoupa = F.avisoFonteParada(ultimaRoupa);
  const avisoDinheiro = F.avisoFonteParada(ultima);
  // Dinheiro e honra são moedas diferentes (não se somam, ver DINHEIRO_ENTRA/
  // SAI vs HONRA) — separadas por uma linha em branco, mesmo respiro que já
  // existe entre SALDO e MOVIMENTO POR TIPO, em vez de emendadas na mesma
  // pilha só porque `somarPorAcoes` devolve as duas juntas.
  const linhasDinheiro = somasTudo.filter(l => !HONRA.includes(l.acao)).map(linhaResumo);
  const linhasHonra = somasTudo.filter(l => HONRA.includes(l.acao)).map(linhaResumo);
  const linhasMovimento = [...linhasDinheiro, ...(linhasHonra.length ? ['', ...linhasHonra] : [])];
  const embed = {
    color: F.COR,
    title: '🏦 CAIXA DO JOGO — GAVIÕES DA FIEL FIVEM',
    description: [
      ...(avisoDinheiro ? [avisoDinheiro, ''] : []),
      manual.saldo?.valor != null
        ? `**SALDO NO BANCO DA TORCIDA:** ${E.formatarDinheiro(manual.saldo.valor)}`
        : '*Saldo ainda não setado — clique em EDITAR.*',
    ].join('\n'),
    fields: F.campoLista('MOVIMENTO POR TIPO (DESDE O PRIMEIRO LOG LIDO)', linhasMovimento, 'Nenhum registro de dinheiro ainda.'),
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
