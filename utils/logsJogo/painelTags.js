const F = require('./painelFormato');
const { criarPainelCanal } = require('./painelCanal');
const { linhaComponentesTags, tagsAtuais } = require('./painelTagsInteracoes');

// Canal 🏷️・tags-do-jogo: mensagem fixa curta (padrão interativo, ver
// painelBau.js). Público — saber quem é do Arsenal ou da Rádio é referência,
// não auditoria. Detalhe (membros por tag, ficha de jogador, fluxo do
// período) mora em painelTagsInteracoes.js.
const SLUG = 'tags_jogo';

async function montarBlocos() {
  const tags = await tagsAtuais();
  const pessoasComTag = new Set(tags.flatMap(t => t.membros.map(m => m.id))).size;

  const embed = {
    color: F.COR,
    title: '🏷️ TAGS DO JOGO — GAVIÕES DA FIEL FIVEM',
    description: [
      `**${tags.length}** ${tags.length === 1 ? 'tag em uso' : 'tags em uso'} · **${pessoasComTag}** ${pessoasComTag === 1 ? 'pessoa com tag' : 'pessoas com tag'}`,
      '*Reconstruído dos logs de adicionar/remover tag. Quem saiu ou foi expulso da torcida perde as tags, '
        + 'e grafias antigas da mesma tag (R.S.J. / RSJ) contam como uma só.*',
      '',
      '*Escolha uma tag abaixo pra ver quem tem, busque um jogador ou veja o que mudou num período.*',
    ].join('\n'),
    footer: { text: F.rodape('canal logs-registros') },
    timestamp: new Date().toISOString(),
  };
  return [{ embeds: [embed], components: linhaComponentesTags(tags), allowedMentions: { parse: [] } }];
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '🏷️・tags-do-jogo',
  razao: 'Tags (funções internas) do jogo a partir dos logs',
  publico: true,
  intervaloMin: 6 * 60,
  montarBlocos,
});

module.exports = {
  iniciarPainelTags: painel.iniciar,
  atualizarPainelTags: painel.atualizar,
  agendarAtualizacaoReativa: painel.agendarAtualizacaoReativa,
};
