const { ehMensagemDeLog, registrosDaMensagem, gravarRegistros } = require('./ingestao');
const { avaliarAlertas } = require('./alertas');
const { agendarAtualizacaoReativa, atualizarPainelJogadores } = require('./painelJogadores');
const { agendarAtualizacaoReativa: agendarRegistrosDiarios } = require('./registrosDiarios');
const { agendarAtualizacaoReativa: agendarIdsSemSocio } = require('./idsSemSocio');
const { incrementarSociosManual } = require('./presencaInteracoes');

// Logs do jogo (webhook do FiveM). O log continua no canal; o bot grava para
// filtros/estatísticas e avalia os alertas (o de novato é o primeiro deles).
// Devolve true quando a mensagem era log (a plataforma para de repassá-la).
//
// `paineis` = módulos de painel de log ligados (manifesto.painelLog): cada um
// decide, olhando os registros novos, se acorda o próprio canal — em vez de
// esta função conhecer todos os painéis (antes eram 12 imports fixos).
async function processarMensagemDeLog(message, client, paineis = []) {
  if (!ehMensagemDeLog(message)) return false;

  const registros = registrosDaMensagem(message);
  let novos = registros;
  try {
    novos = await gravarRegistros(registros);
  } catch (err) {
    // Banco fora do ar não pode calar o alerta: avalia com o que chegou
    console.error('[logs-jogo] Erro ao gravar log:', err);
  }
  await avaliarAlertas(client, novos).catch(err => console.error('[logs-jogo] Erro nos alertas:', err));
  // Entrada/saída de jogador: atualiza o painel de presença e o registro
  // diário do dia em andamento logo (em vez de esperar o próximo ciclo
  // de tempo — 5min e 6h, respectivamente).
  if (novos.some(r => r.categoria === 'conexao')) {
    agendarAtualizacaoReativa(client);
    agendarRegistrosDiarios(client);
  }
  // ID do jogo novo nos logs: pode passar a bater (ou deixar de bater)
  // com o filtro de frequência do canal de IDs sem Discord.
  if (novos.some(r => r.atorIdFivem || r.alvoIdFivem)) {
    agendarIdsSemSocio(client);
  }
  // "Fulano recrutou beltrano" no log do próprio jogo: soma 1 em SÓCIOS
  // SETADOS por recrutamento novo (só os que `gravarRegistros` não tinha
  // visto ainda — reprocessar um log antigo não conta de novo) e
  // atualiza o painel na hora, sem esperar o botão EDITAR.
  const recrutamentos = novos.filter(r => r.acao === 'jogador_recrutou').length;
  if (recrutamentos > 0) {
    await incrementarSociosManual(recrutamentos).catch(err => console.error('[logs-jogo] Erro ao somar sócios setados:', err));
    await atualizarPainelJogadores(client).catch(err => console.error('[logs-jogo] Erro ao atualizar painel após recrutamento:', err));
  }
  // Cada canal de inteligência acorda só com o tipo de log que é dele
  // (debounce próprio em cada painel, ver painelCanal.js) — em vez de os
  // oito reprocessarem tudo a cada log que chega. Um painel com erro não
  // impede os outros (nem o resto da mensagem).
  for (const painel of paineis) {
    if (typeof painel.aoRegistros !== 'function') continue;
    try {
      await painel.aoRegistros(novos, client);
    } catch (err) {
      console.error('[logs-jogo] Erro num painel de log:', err);
    }
  }
  return true;
}

module.exports = { processarMensagemDeLog };
