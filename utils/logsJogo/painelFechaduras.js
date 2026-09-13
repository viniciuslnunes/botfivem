const { criarPainelCanal } = require('./painelCanal');
const { linhaComponentesFechaduras, embedEstadoAtual } = require('./painelFechadurasInteracoes');

// Canal 🔐・fechaduras: mensagem fixa = o próprio estado atual (são só ~10
// fechaduras, cabe direto — sem precisar do botão pra ver o resumo). O
// detalhe interativo (ficha de jogador, ranking por período) mora em
// painelFechadurasInteracoes.js, mesmo padrão dos outros canais.
const SLUG = 'fechaduras';

async function montarBlocos() {
  const embed = await embedEstadoAtual();
  return [{ embeds: [embed], components: linhaComponentesFechaduras(), allowedMentions: { parse: [] } }];
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '🔐・fechaduras',
  razao: 'Estado das fechaduras da sede a partir dos logs do jogo',
  intervaloMin: 15,
  montarBlocos,
});

module.exports = {
  iniciarPainelFechaduras: painel.iniciar,
  atualizarPainelFechaduras: painel.atualizar,
  agendarAtualizacaoReativa: painel.agendarAtualizacaoReativa,
};
