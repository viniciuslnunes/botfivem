const repo = require('./repositorio');
const E = require('./estatisticas');
const F = require('./painelFormato');
const A = require('./analises');
const { criarPainelCanal } = require('./painelCanal');
const { linhaComponentesDisciplina } = require('./painelDisciplinaInteracoes');

// Canal ⚖️・disciplina-jogo: mensagem fixa curta (padrão interativo, ver
// painelBau.js) — o detalhe (advertências abertas, ficha por jogador, fluxo do
// período) mora em painelDisciplinaInteracoes.js.
const SLUG = 'disciplina_jogo';
const ACOES_MULTA = ['multou'];

async function montarBlocos() {
  const [eventosAdv, ultimaAdv, ultimaMulta, totalMultas] = await Promise.all([
    repo.listarPorAcoes(A.ACOES_ADVERTENCIA, E.resolverPeriodo('tudo'), 4000),
    repo.ultimaOcorrencia(A.ACOES_ADVERTENCIA),
    repo.ultimaOcorrencia(ACOES_MULTA),
    repo.contarPorAcoes(ACOES_MULTA, E.resolverPeriodo('tudo')),
  ]);
  const ativas = A.advertenciasAtivas(eventosAdv);
  const servicosPendentes = ativas.reduce((t, a) => t + (a.servicos ?? 0), 0);
  const avisoAdv = F.avisoFonteParada(ultimaAdv);
  const avisoMulta = F.avisoFonteParada(ultimaMulta);

  const embed = {
    color: F.COR,
    title: '⚖️ DISCIPLINA DO JOGO — GAVIÕES DA FIEL FIVEM',
    description: [
      ...(avisoAdv ? [avisoAdv, ''] : []),
      ...(avisoMulta ? [avisoMulta, ''] : []),
      `**ADVERTÊNCIAS ABERTAS:** ${E.formatarNumero(ativas.length)}`,
      `**SERVIÇOS PENDENTES:** ${E.formatarNumero(servicosPendentes)}`,
      `**MULTAS (HISTÓRICO):** ${E.formatarNumero(totalMultas[0]?.total ?? 0)}`,
      '',
      '*Veja quem está com advertência aberta, busque um jogador ou veja o fluxo de um período nos botões abaixo.*',
    ].join('\n'),
    footer: { text: F.rodape('canais logs-registros e logs-liderança') },
    timestamp: new Date().toISOString(),
  };
  return [{ embeds: [embed], components: linhaComponentesDisciplina(), allowedMentions: { parse: [] } }];
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '⚖️・disciplina-jogo',
  razao: 'Advertências, serviços e multas do jogo a partir dos logs',
  intervaloMin: 30,
  montarBlocos,
});

module.exports = {
  iniciarPainelDisciplina: painel.iniciar,
  atualizarPainelDisciplina: painel.atualizar,
  agendarAtualizacaoReativa: painel.agendarAtualizacaoReativa,
};
