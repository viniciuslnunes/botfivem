const config = require('../../config/index.js');
const repo = require('./repositorio');
const E = require('./estatisticas');
const F = require('./painelFormato');
const A = require('./analises');
const { criarPainelCanal } = require('./painelCanal');
const { registrarConsulta, selectPeriodo } = require('./painelConsulta');

// Canal 🧩・logs-nao-reconhecidos: as famílias de log que o parser ainda não
// entende, agrupadas por FORMATO, com contagem, exemplo e canal de origem.
//
// Este é o painel que garante os outros sete. Log que o parser não reconhece
// nunca é descartado (vira acao 'desconhecido'), mas até agora também não era
// visto por ninguém — foi assim que 12% de tudo o que o jogo publica ficou
// parado no banco. Formato novo (ou mudança de texto num formato existente) passa
// a aparecer aqui em horas, e cada família aqui é uma regra a escrever em
// parser.js. A meta do canal é ficar vazio.
const SLUG = 'logs_nao_reconhecidos';
const AMOSTRA_MAX = 5000; // registros lidos pra agrupar (os mais recentes)
const FAMILIAS_MAX = 30;

function linhaFamilia(f, i) {
  const origem = F.nomeCanal(f.canalId);
  return `**${i + 1}. ${E.formatarNumero(f.total)}×** \`${origem}\``
    + (f.titulo ? ` · título \`${E.truncar(F.nomeSeguro(f.titulo), 40)}\`` : '')
    + `\n   ${E.truncar(F.nomeSeguro(f.exemplo), 180)}`
    + `\n   *${E.formatarDataHora(f.primeira)} → ${E.formatarDataHora(f.ultima)}*`;
}

async function montarBlocos() {
  const registros = await repo.desconhecidos(E.resolverPeriodo('tudo'), AMOSTRA_MAX);
  const familias = A.agruparDesconhecidos(registros);
  const mostradas = familias.slice(0, FAMILIAS_MAX);

  return F.blocosDeEmbeds(F.embedsDeLista({
    titulo: '🧩 LOGS QUE O BOT AINDA NÃO ENTENDE',
    cabecalho: familias.length
      ? [
        `**${E.formatarNumero(registros.length)}** registros em **${familias.length}** ${familias.length === 1 ? 'família de formato' : 'famílias de formato'}`
          + (familias.length > FAMILIAS_MAX ? ` (mostrando as ${FAMILIAS_MAX} maiores)` : ''),
        '*Nada foi perdido: o log está gravado, só não virou estatística ainda.*',
        '*Cada família aqui é uma regra a escrever no parser — a meta deste canal é ficar vazio.*',
      ].join('\n')
      : 'Todo log que chegou foi reconhecido pelo parser. ✅',
    linhas: mostradas.map(linhaFamilia),
    vazio: 'Nada pendente — o parser entende tudo o que o jogo está publicando.',
    origem: 'todos os canais de log',
  }));
}

function montarAcao() {
  return {
    content: '👇 **VER O QUE NÃO FOI RECONHECIDO NUM PERÍODO** (formato novo aparece como família nova)',
    components: [selectPeriodo(SLUG, 'ESCOLHA UM PERÍODO')],
  };
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '🧩・logs-nao-reconhecidos',
  razao: 'Famílias de log que o parser ainda não reconhece',
  intervaloMin: 12 * 60,
  debounceMs: 5 * 60 * 1000, // formato novo não é urgente; evita reprocessar a amostra toda a cada log
  montarBlocos,
  montarAcao,
});

registrarConsulta(SLUG, async periodo => {
  const registros = await repo.desconhecidos(periodo, AMOSTRA_MAX);
  const familias = A.agruparDesconhecidos(registros);
  return {
    embeds: F.embedsDeLista({
      titulo: `🧩 NÃO RECONHECIDOS — ${periodo.rotulo}`,
      cabecalho: `**${E.formatarNumero(registros.length)}** registros em **${familias.length}** famílias no período.`,
      linhas: familias.slice(0, FAMILIAS_MAX).map(linhaFamilia),
      vazio: 'Nada não reconhecido no período. ✅',
      origem: 'todos os canais de log',
    }).slice(0, 1),
  };
}, painel.agendarAtualizacaoReativa);

module.exports = {
  iniciarPainelDesconhecidos: painel.iniciar,
  atualizarPainelDesconhecidos: painel.atualizar,
  agendarAtualizacaoReativa: painel.agendarAtualizacaoReativa,
};
