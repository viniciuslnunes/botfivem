// Inteligência cruzada: junta o que o Discord sabe (advertências, fichas, eventos, tickets) com o
// que o jogo publica (restrições, baú, banco, presença) para achar padrões que nenhum painel
// mostra sozinho. Só informa; a liderança decide. Regras em docs/contratos/regras-negocio.md.
module.exports = {
  id: 'inteligencia',
  descricao: 'Inteligência cruzada: risco do associado, reincidência, barreira de entrada, boletim semanal e /inteligencia',
  padrao: true,
  requer: ['logsJogo', 'advertencia', 'recrutamento', 'bloqueioId', 'eventos', 'confianca', 'departamentos', 'ticket'],
  comandos: ['inteligencia'],
  carregar() {
    require('../utils/inteligencia/interacoes'); // botões dos alertas (RESOLVIDO, IGNORAR e as ações de cada tipo)
    // Barreira de entrada: cruza cada ficha nova com blacklist, não recrutar e reprovados por nome
    require('../utils/recrutamento/ganchos').aoFichaEnviada(require('../utils/inteligencia/barreira').avisarNaFicha);
    // Fluxos que se conversam: ficha decidida, ADV registrada e ticket aberto disparam consequências
    // (acompanhamento do recém-aprovado, resumo/reincidência na hora, contexto no ticket) e o resumo
    // de risco aparece na ficha do associado e no contexto da ADV pendente.
    require('../utils/inteligencia/fluxos').assinar();
  },
  aoIniciar(client) {
    require('../utils/inteligencia/varredura').iniciar(client);
    require('../utils/inteligencia/boletim').iniciar(client);
    require('../utils/inteligencia/diario').iniciar(client);
  },
};
