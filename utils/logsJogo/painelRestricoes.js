const E = require('./estatisticas');
const F = require('./painelFormato');
const A = require('./analises');
const { criarPainelCanal } = require('./painelCanal');
const { linhaComponentesRestricoes, buscarAtivas } = require('./painelRestricoesInteracoes');

// Canal ⛔・banidos-e-impedidos: mensagem fixa curta (padrão interativo, ver
// painelBau.js) — a lista por tipo, a ficha de jogador e o fluxo do período
// moram em painelRestricoesInteracoes.js.
const SLUG = 'banidos_impedidos';

let clientAtual = null;

async function montarBlocos() {
  const ativas = await buscarAtivas(clientAtual, null);
  const porTipo = Object.fromEntries(Object.keys(A.TIPOS_RESTRICAO).map(t => [t, ativas.filter(r => r.tipo === t).length]));
  const faltaBloquear = ativas.filter(r => r.bloqueadoNoDiscord === false).length;

  const embed = {
    color: F.COR,
    title: '⛔ BANIDOS E IMPEDIDOS — GAVIÕES DA FIEL FIVEM',
    description: [
      `**BLACKLIST:** ${E.formatarNumero(porTipo.blacklist ?? 0)}`,
      `**SUSPENSÃO:** ${E.formatarNumero(porTipo.suspensao ?? 0)}`,
      `**IMPEDIMENTO:** ${E.formatarNumero(porTipo.impedimento ?? 0)}`,
      faltaBloquear ? `⚠️ **${faltaBloquear}** com blacklist ainda fora do ❌・nao-recrutar` : '✅ Blacklist toda cruzada com o não-recrutar',
      '',
      '*Veja a lista por tipo, busque um jogador ou veja o que mudou num período nos botões abaixo.*',
    ].join('\n'),
    footer: { text: F.rodape('canal logs-registros') },
    timestamp: new Date().toISOString(),
  };
  return [{ embeds: [embed], components: linhaComponentesRestricoes(), allowedMentions: { parse: [] } }];
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '⛔・banidos-e-impedidos',
  razao: 'Blacklist, suspensão e impedimento do jogo a partir dos logs',
  intervaloMin: 60,
  montarBlocos,
});

// `montarBlocos` precisa do client (cruza com o histórico do não-recrutar) e o
// esqueleto do painel não o passa — guardar aqui mantém a assinatura igual
// pros outros painéis (mesma solução da versão anterior deste arquivo).
function iniciar(client) { clientAtual = client; painel.iniciar(client); }
function atualizar(client) { clientAtual = client; return painel.atualizar(client); }
function agendarAtualizacaoReativa(client) { clientAtual = client; painel.agendarAtualizacaoReativa(client); }

module.exports = { iniciarPainelRestricoes: iniciar, atualizarPainelRestricoes: atualizar, agendarAtualizacaoReativa };
