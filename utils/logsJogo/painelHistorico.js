const F = require('./painelFormato');
const { criarPainelCanal } = require('./painelCanal');
const { linhaComponentesHistorico } = require('./painelHistoricoInteracoes');
const tema = require('../../tema');

// Canal 📜・historico-do-associado: cruza tudo que os outros canais de
// inteligência (presença, carreira, baú, caixa, disciplina, restrições,
// tags, território, fechaduras) já sabem sobre UM jogador só, pra não
// precisar abrir canal por canal pra montar a ficha completa de um associado.
// Mensagem fixa é só a instrução — o cruzamento de verdade acontece
// ephemeral, ao escolher o jogador no select (painelHistoricoInteracoes.js).
// Liderança apenas: junta dado sensível (disciplina, restrições, dinheiro)
// que já é auditoria fechada nos canais de origem.
const SLUG = 'historico_associado';

function montarBlocos() {
  return [{
    embeds: [{
      color: F.COR,
      title: tema.titulo('📜 HISTÓRICO DO ASSOCIADO'),
      description: [
        'Cruza tudo que já temos registrado sobre UM jogador: presença, carreira,',
        'baú, caixa, disciplina, restrições, tags, território e fechaduras.',
        '',
        'Escolha o jogador no select abaixo — a resposta é ephemeral (só quem',
        'clicou vê) e traz um resumo com um segundo select pra abrir o histórico',
        'completo de cada item, incluindo o log bruto sem filtro nenhum.',
      ].join('\n'),
      footer: { text: F.rodape('todos os canais de log do jogo') },
    }],
  }];
}

function montarAcao() {
  return { components: linhaComponentesHistorico() };
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '📜・historico-do-associado',
  razao: 'Ficha cruzada de um associado a partir de todos os canais de log do jogo',
  intervaloMin: 240,
  montarBlocos,
  montarAcao,
});

module.exports = {
  iniciarPainelHistorico: painel.iniciar,
  atualizarPainelHistorico: painel.atualizar,
};
