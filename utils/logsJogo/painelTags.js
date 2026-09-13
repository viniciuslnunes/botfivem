const repo = require('./repositorio');
const E = require('./estatisticas');
const F = require('./painelFormato');
const A = require('./analises');
const { criarPainelCanal } = require('./painelCanal');
const { registrarConsulta, selectPeriodo } = require('./painelConsulta');

// Canal 🏷️・tags-do-jogo: quem tem qual tag/função dentro do jogo hoje — RSJ,
// Arsenal, Materiais, Rádio, Divulgação, Resp. Eventos, Resp. Denúncias…
//
// É o equivalente dos DEPARTAMENTOS do Discord, mas do lado do jogo, e ninguém
// tinha como conferir um contra o outro: são 917 eventos de tag nos logs que não
// eram lidos. O quadro aqui é reconstruído dos "adicionou tag"/"removeu tag" —
// quem aparece é quem ainda tem a tag (o último evento dele naquela tag foi um
// "adicionou").
const SLUG = 'tags_jogo';
const HISTORICO_MAX = 6000;
const TOP = 10;

function linhaMembro(m) {
  return `   ${F.pessoa(m)}`;
}

function blocoTag({ tag, membros }) {
  return [`🏷️ **${F.nomeSeguro(tag).toUpperCase()}** (${membros.length})`, ...membros.map(linhaMembro)].join('\n');
}

function linhaTop(l, i) {
  return `${i + 1}. ${F.pessoa(l)} — ${E.formatarNumero(l.total)}`;
}

async function montarBlocos() {
  const [eventos, topMexeu] = await Promise.all([
    // Saídas da torcida vêm junto: quem sai ou é expulso perde as tags sem que o
    // jogo publique "removeu tag" (ver analises.tagsAtivas).
    repo.listarPorAcoes([...A.ACOES_TAG, ...A.ACOES_SAIDA], E.resolverPeriodo('tudo'), HISTORICO_MAX),
    repo.topAtoresPorAcoes(A.ACOES_TAG, E.resolverPeriodo('90d'), TOP),
  ]);

  const tags = A.tagsAtivas(eventos);
  const pessoasComTag = new Set(tags.flatMap(t => t.membros.map(m => m.id))).size;

  return F.blocosDeEmbeds(F.embedsDeLista({
    titulo: '🏷️ TAGS DO JOGO — QUEM TEM O QUÊ',
    cabecalho: [
      `**${tags.length}** ${tags.length === 1 ? 'tag em uso' : 'tags em uso'} · **${pessoasComTag}** ${pessoasComTag === 1 ? 'pessoa com tag' : 'pessoas com tag'}`,
      '*Reconstruído dos logs de adicionar/remover tag. Quem saiu ou foi expulso da torcida perde as tags, '
        + 'e grafias antigas da mesma tag (R.S.J. / RSJ) contam como uma só.*',
    ].join('\n'),
    linhas: tags.map(blocoTag),
    vazio: 'Nenhuma tag registrada nos logs ainda.',
    origem: 'canal logs-registros',
    fields: topMexeu.length
      ? [{ name: 'QUEM MAIS MEXEU EM TAG (90 DIAS)', value: E.truncar(topMexeu.map(linhaTop).join('\n'), 1024) }]
      : [],
  }));
}

function montarAcao() {
  return {
    content: '👇 **VER AS MUDANÇAS DE TAG NUM PERÍODO**',
    components: [selectPeriodo(SLUG, 'ESCOLHA UM PERÍODO')],
  };
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '🏷️・tags-do-jogo',
  razao: 'Tags (funções internas) do jogo a partir dos logs',
  publico: true, // saber quem é do Arsenal ou da Rádio não é auditoria, é referência
  intervaloMin: 6 * 60,
  montarBlocos,
  montarAcao,
});

registrarConsulta(SLUG, async periodo => {
  const eventos = await repo.listarPorAcoes(A.ACOES_TAG, periodo, 40);
  return {
    embeds: F.embedsDeLista({
      titulo: `🏷️ MUDANÇAS DE TAG — ${periodo.rotulo}`,
      cabecalho: 'Movimento do período (o quadro de quem tem cada tag HOJE fica no topo do canal).',
      linhas: eventos.map(e =>
        `${e.acao === 'tag_adicionou' ? '➕' : '➖'} ${F.pessoa({ nome: e.alvo_nome, id: e.alvo_id_fivem })}`
        + ` · **${F.nomeSeguro(E.extrairEntreParenteses(e.descricao) ?? '?')}**`
        + ` — por ${F.nomeSeguro(e.ator_nome)}, ${E.formatarDataHora(e.ocorrido_em)}`),
      vazio: 'Nenhuma mudança de tag no período.',
      origem: 'canal logs-registros',
    }).slice(0, 1),
  };
}, painel.agendarAtualizacaoReativa);

module.exports = {
  iniciarPainelTags: painel.iniciar,
  atualizarPainelTags: painel.atualizar,
  agendarAtualizacaoReativa: painel.agendarAtualizacaoReativa,
};
