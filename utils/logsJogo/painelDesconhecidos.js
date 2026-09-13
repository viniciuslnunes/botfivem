const E = require('./estatisticas');
const F = require('./painelFormato');
const A = require('./analises');
const repo = require('./repositorio');
const { criarPainelCanal } = require('./painelCanal');
const { linhaComponentesDesconhecidos } = require('./painelDesconhecidosInteracoes');

// Canal 🧩・logs-nao-reconhecidos: mensagem fixa curta (padrão interativo, ver
// painelBau.js). Este é o painel que garante os outros: log que o parser não
// reconhece nunca é descartado, mas até 2026-09-13 também não era visto por
// ninguém — foi assim que 12% de tudo o que o jogo publica ficou parado no
// banco. A meta deste canal é ficar vazio.
const SLUG = 'logs_nao_reconhecidos';
const AMOSTRA_MAX = 5000;

async function montarBlocos() {
  const registros = await repo.desconhecidos(E.resolverPeriodo('tudo'), AMOSTRA_MAX);
  const familias = A.agruparDesconhecidos(registros);

  const embed = {
    color: F.COR,
    title: '🧩 LOGS QUE O BOT AINDA NÃO ENTENDE',
    description: familias.length
      ? [
        `**${E.formatarNumero(registros.length)}** registros em **${familias.length}** ${familias.length === 1 ? 'família de formato' : 'famílias de formato'}`,
        '*Nada foi perdido: o log está gravado, só não virou estatística ainda.*',
        '*Cada família é uma regra a escrever no parser — a meta deste canal é ficar vazio.*',
        '',
        '*Veja as famílias de um período ou o histórico completo nos botões abaixo.*',
      ].join('\n')
      : 'Todo log que chegou foi reconhecido pelo parser. ✅',
    footer: { text: F.rodape('todos os canais de log') },
    timestamp: new Date().toISOString(),
  };
  return [{ embeds: [embed], components: linhaComponentesDesconhecidos(), allowedMentions: { parse: [] } }];
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '🧩・logs-nao-reconhecidos',
  razao: 'Famílias de log que o parser ainda não reconhece',
  intervaloMin: 12 * 60,
  debounceMs: 5 * 60 * 1000,
  montarBlocos,
});

module.exports = {
  iniciarPainelDesconhecidos: painel.iniciar,
  atualizarPainelDesconhecidos: painel.atualizar,
  agendarAtualizacaoReativa: painel.agendarAtualizacaoReativa,
};
