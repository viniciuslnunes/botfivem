const repo = require('./repositorio');
const E = require('./estatisticas');
const F = require('./painelFormato');
const A = require('./analises');
const { criarPainelCanal } = require('./painelCanal');
const { linhaComponentesDisciplina } = require('./painelDisciplinaInteracoes');
const tema = require('../../tema');
const fonte = require('./fonte');

// Canal ⚖️・disciplina-jogo: mensagem fixa curta (padrão interativo, ver
// painelBau.js) — advertências abertas já saem aqui; o detalhe (ficha por
// jogador, fluxo do período) mora em painelDisciplinaInteracoes.js.
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
  // `ultimaAdv` null (não só "sem log recente", sem log NENHUM) quer dizer
  // que não existe fonte de advertência pra esta fonte de logs — o canal que logava
  // isso (logs-liderança) era de outra comunidade (Fanáticos), removido em
  // 2026-09-13. Sem esse aviso, "0" parece disciplina em dia, não "métrica
  // sem fonte alguma pra medir".
  const semFonteAdv = !ultimaAdv;
  const avisoAdv = semFonteAdv
    ? `*Sem fonte de log de advertência pro ${fonte.nome} — este número nunca sai de 0.*`
    : F.avisoFonteParada(ultimaAdv);
  const avisoMulta = F.avisoFonteParada(ultimaMulta);

  const embed = {
    color: F.COR,
    title: tema.titulo('⚖️ DISCIPLINA DO JOGO'),
    description: [
      ...(avisoAdv ? [avisoAdv, ''] : []),
      ...(avisoMulta ? [avisoMulta, ''] : []),
      `**ADVERTÊNCIAS ABERTAS:** ${E.formatarNumero(ativas.length)}`,
      `**SERVIÇOS PENDENTES:** ${E.formatarNumero(servicosPendentes)}`,
      `**MULTAS (HISTÓRICO):** ${E.formatarNumero(totalMultas[0]?.total ?? 0)}`,
    ].join('\n'),
    footer: { text: F.rodape('canal logs-registros') },
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
