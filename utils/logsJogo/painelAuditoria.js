const repo = require('./repositorio');
const E = require('./estatisticas');
const F = require('./painelFormato');
const { criarPainelCanal } = require('./painelCanal');
const { registrarConsulta, selectPeriodo } = require('./painelConsulta');

// Canal ⚙️・auditoria-config: quem mexeu na CONFIGURAÇÃO do sistema da torcida
// dentro do jogo — webhook de log, webhook de presença, integração do Discord,
// definição de tag e criação/edição de cargo.
//
// É o menor volume de todos (~50 eventos) e o de maior risco: quem troca o
// `webhook_log` troca a própria fonte de todos os outros painéis, e nada no
// Discord avisaria. Por isso o canal existe mesmo com pouca linha.
const SLUG = 'auditoria_config';
const ACOES = ['config_alterou', 'tag_alterou', 'cargo_editado'];
const LIMITE = 40;
const TOP = 10;

const ROTULOS = {
  config_alterou: '⚙️ CONFIGURAÇÃO',
  tag_alterou: '🏷️ DEFINIÇÃO DE TAG',
  cargo_editado: '👑 CARGO DO JOGO',
};

// "criou/editou o cargo" vem só com o ID ("O jogador ID 953"): o nome é
// emprestado dos outros canais, senão a auditoria mostrava número cru.
const comNomesDoAtor = linhas => F.comNomes(linhas, { id: 'ator_id_fivem', nome: 'ator_nome' });

function detalhe(e) {
  if (e.acao === 'tag_alterou') {
    const mudanca = E.extrairMudancaCargo(e.descricao);
    return mudanca ? `${F.nomeSeguro(mudanca.de)} → ${F.nomeSeguro(mudanca.para)}` : 'tag redefinida';
  }
  return e.alvo_nome ? F.nomeSeguro(e.alvo_nome) : '—';
}

function linhaEvento(e) {
  return `${ROTULOS[e.acao] ?? e.acao} **${detalhe(e)}**`
    + ` — ${F.pessoa({ nome: e.ator_nome, id: e.ator_id_fivem })}, ${E.formatarDataHora(e.ocorrido_em)}`;
}

function linhaTop(l, i) {
  return `${i + 1}. ${F.pessoa(l)} — ${E.formatarNumero(l.total)} ${l.total === 1 ? 'alteração' : 'alterações'}`;
}

async function montarBlocos() {
  const tudo = E.resolverPeriodo('tudo');
  const [eventos, contagens, topMexeu] = await Promise.all([
    repo.listarPorAcoes(ACOES, tudo, LIMITE).then(comNomesDoAtor),
    repo.contarPorAcoes(ACOES, tudo),
    repo.topAtoresPorAcoes(ACOES, tudo, TOP).then(F.comNomes),
  ]);

  // Mexer no webhook é o caso que muda o que os outros painéis conseguem ver:
  // vale destacar separado, não diluído na lista.
  const webhooks = eventos.filter(e => e.acao === 'config_alterou' && /webhook/i.test(e.alvo_nome ?? ''));

  return F.blocosDeEmbeds(F.embedsDeLista({
    titulo: '⚙️ AUDITORIA DE CONFIGURAÇÃO DO JOGO',
    cabecalho: [
      `Últimas **${eventos.length}** alterações registradas`
        + (contagens.length ? ` · total no histórico: ${E.formatarNumero(contagens.reduce((t, c) => t + c.total, 0))}` : ''),
      '*Volume baixo de propósito: é aqui que aparece quem mexe na fonte dos logs e nos cargos do jogo.*',
    ].join('\n'),
    linhas: eventos.map(linhaEvento),
    vazio: 'Nenhuma alteração de configuração registrada.',
    origem: 'canais logs-registros e logs-liderança',
    fields: [
      ...(webhooks.length ? [{
        name: '🚨 ALTERAÇÕES DE WEBHOOK (MEXEM NA FONTE DESTES PAINÉIS)',
        value: E.truncar(webhooks.map(e =>
          `• **${F.nomeSeguro(e.alvo_nome)}** — ${F.pessoa({ nome: e.ator_nome, id: e.ator_id_fivem })}, ${E.formatarDataHora(e.ocorrido_em)}`
        ).join('\n'), 1024),
      }] : []),
      ...(topMexeu.length ? [{ name: 'QUEM MAIS ALTEROU (TODO O HISTÓRICO)', value: E.truncar(topMexeu.map(linhaTop).join('\n'), 1024) }] : []),
    ],
  }));
}

function montarAcao() {
  return {
    content: '👇 **VER AS ALTERAÇÕES DE UM PERÍODO**',
    components: [selectPeriodo(SLUG, 'ESCOLHA UM PERÍODO')],
  };
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '⚙️・auditoria-config',
  razao: 'Auditoria das alterações de configuração e cargos do jogo',
  intervaloMin: 6 * 60,
  montarBlocos,
  montarAcao,
});

registrarConsulta(SLUG, async periodo => ({
  embeds: F.embedsDeLista({
    titulo: `⚙️ CONFIGURAÇÃO — ${periodo.rotulo}`,
    cabecalho: 'Alterações registradas no período.',
    linhas: (await repo.listarPorAcoes(ACOES, periodo, LIMITE).then(comNomesDoAtor)).map(linhaEvento),
    vazio: 'Nenhuma alteração no período.',
    origem: 'canais logs-registros e logs-liderança',
  }).slice(0, 1),
}), painel.agendarAtualizacaoReativa);

module.exports = {
  iniciarPainelAuditoria: painel.iniciar,
  atualizarPainelAuditoria: painel.atualizar,
  agendarAtualizacaoReativa: painel.agendarAtualizacaoReativa,
};
