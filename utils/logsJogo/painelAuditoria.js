const repo = require('./repositorio');
const E = require('./estatisticas');
const F = require('./painelFormato');
const { criarPainelCanal } = require('./painelCanal');
const { linhaComponentesAuditoria, ACOES, linhaEvento } = require('./painelAuditoriaInteracoes');

// Canal ⚙️・auditoria-config: mensagem fixa curta (padrão interativo, ver
// painelBau.js). Detalhe (histórico paginado, ficha de jogador, alterações do
// período) mora em painelAuditoriaInteracoes.js.
const SLUG = 'auditoria_config';

async function montarBlocos() {
  const tudo = E.resolverPeriodo('tudo');
  const [contagens, ultimosWebhook] = await Promise.all([
    repo.contarPorAcoes(ACOES, tudo),
    repo.listarPorAcoes(['config_alterou'], tudo, 20).then(l => F.comNomes(l, { id: 'ator_id_fivem', nome: 'ator_nome' })),
  ]);
  const webhooks = ultimosWebhook.filter(e => /webhook/i.test(e.alvo_nome ?? ''));
  const total = contagens.reduce((t, c) => t + c.total, 0);

  const embed = {
    color: F.COR,
    title: '⚙️ AUDITORIA DE CONFIGURAÇÃO — GAVIÕES DA FIEL FIVEM',
    description: [
      `**TOTAL DE ALTERAÇÕES:** ${E.formatarNumero(total)}`,
      '*Volume baixo de propósito: é aqui que aparece quem mexe na fonte dos logs e nos cargos do jogo.*',
      '',
      '*Veja o histórico completo, busque quem alterou ou veja um período nos botões abaixo.*',
    ].join('\n'),
    fields: webhooks.length
      ? [{ name: '🚨 ALTERAÇÕES DE WEBHOOK (MEXEM NA FONTE DESTES PAINÉIS)', value: E.truncar(webhooks.slice(0, 5).map(linhaEvento).join('\n'), 1024) }]
      : [],
    footer: { text: F.rodape('canais logs-registros e logs-liderança') },
    timestamp: new Date().toISOString(),
  };
  return [{ embeds: [embed], components: linhaComponentesAuditoria(), allowedMentions: { parse: [] } }];
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '⚙️・auditoria-config',
  razao: 'Auditoria das alterações de configuração e cargos do jogo',
  intervaloMin: 6 * 60,
  montarBlocos,
});

module.exports = {
  iniciarPainelAuditoria: painel.iniciar,
  atualizarPainelAuditoria: painel.atualizar,
  agendarAtualizacaoReativa: painel.agendarAtualizacaoReativa,
};
