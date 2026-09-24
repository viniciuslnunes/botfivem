// Coração do produto: lê os logs que o servidor de jogo publica por webhook,
// grava no Postgres e alimenta alertas e painéis. Os canais de inteligência
// específicos (baú, caixa, farm…) são módulos próprios (modulos/painel*.js).
module.exports = {
  id: 'logsJogo',
  descricao: 'Logs do jogo: ingestão do webhook, alertas, presença, registros diários e consultas',
  padrao: true,
  requer: ['departamentos', 'bloqueioId'],
  comandos: ['logs', 'logs-sincronizar', 'estatisticas', 'registros-diarios-reconstruir', 'registros-diarios-reformatar'],
  carregar() {
    // Registram os handlers dos botões/selects (prefixos logs, presenca, registrodia, idsemsocio)
    require('../utils/logsJogo/consultas');
    require('../utils/logsJogo/painelJogadores');
    require('../utils/logsJogo/painelSociosSemId');
    require('../utils/logsJogo/registrosDiarios');
    require('../utils/logsJogo/idsSemSocio');
    require('../utils/logsJogo/painel');
  },

  // Recupera logs que chegaram com o bot desligado. Os painéis só começam
  // depois: postar antes mostraria tudo zerado até o backfill acabar.
  aoIniciar(client, ctx) {
    const { sincronizarCanaisDeLog, reprocessarDesconhecidos } = require('../utils/logsJogo/ingestao');
    const { iniciarPainelLogs } = require('../utils/logsJogo/painel');
    const { iniciarPainelJogadores } = require('../utils/logsJogo/painelJogadores');
    const { iniciarPainelSociosSemId } = require('../utils/logsJogo/painelSociosSemId');
    const { iniciarRegistrosDiarios } = require('../utils/logsJogo/registrosDiarios');
    const { iniciarIdsSemSocio } = require('../utils/logsJogo/idsSemSocio');

    const iniciar = (nome, fn) => {
      try {
        const r = fn();
        if (r && typeof r.catch === 'function') r.catch(err => console.error(`[logs-jogo] Erro ao iniciar ${nome}:`, err));
      } catch (err) {
        console.error(`[logs-jogo] Erro ao iniciar ${nome}:`, err);
      }
    };

    return sincronizarCanaisDeLog(client)
      .then(resultados => console.log('[logs-jogo] Sincronização inicial:', resultados))
      // Log antigo que caiu em 'desconhecido' e que o parser já aprende hoje:
      // relido do embed cru e corrigido no banco, senão regra nova só valeria
      // pro que chegar daqui pra frente e os painéis nasceriam sem histórico.
      .then(() => reprocessarDesconhecidos())
      .then(r => console.log(`[logs-jogo] Reprocessamento: ${r.corrigidos}/${r.lidos} registros reconhecidos.`))
      .catch(err => console.error('[logs-jogo] Erro na sincronização inicial:', err))
      .finally(() => {
        iniciar('painel de logs', () => iniciarPainelLogs(client));
        iniciar('painel de jogadores', () => iniciarPainelJogadores(client));
        iniciar('sócios sem ID', () => iniciarPainelSociosSemId(client));
        iniciar('registros diários', () => iniciarRegistrosDiarios(client));
        iniciar('IDs sem Discord', () => iniciarIdsSemSocio(client));
        // Canais de inteligência por tipo de log (cada um monta o próprio canal
        // na primeira execução e reedita as mesmas mensagens depois).
        for (const painel of ctx.paineisDeLog()) iniciar('painel de log', () => painel.iniciar(client));
      });
  },

  // Mensagem de log do webhook: grava, alerta e acorda os painéis.
  aoMensagem(message, client, ctx) {
    return require('../utils/logsJogo/pipeline').processarMensagemDeLog(message, client, ctx.paineisDeLog());
  },

  aoMembroAtualizado(antes, depois, client) {
    const config = require('../config/index.js');
    const { idFivemDoNick } = require('../utils/logsJogo/estatisticas');
    const { agendarAtualizacaoReativa: agendarSociosSemId } = require('../utils/logsJogo/painelSociosSemId');
    const { agendarAtualizacaoReativa: agendarIdsSemSocio } = require('../utils/logsJogo/idsSemSocio');

    const eraSocio = antes.roles.cache.has(config.cargos.socio);
    const ehSocioAgora = depois.roles.cache.has(config.cargos.socio);
    const idMudou = idFivemDoNick(antes.nickname ?? antes.displayName) !== idFivemDoNick(depois.nickname ?? depois.displayName);

    // Canal "sócio sem ID": só recalcula se o apelido mudou (pode ter
    // acabado de vincular/perder o ID) ou se ganhou/perdeu o cargo SÓCIO
    // (entra ou sai da lista de quem é cobrado ali) — comparar o ID lido
    // evita reagendar em toda troca de apelido que não mexe nisso.
    if ((eraSocio || ehSocioAgora) && (eraSocio !== ehSocioAgora || idMudou)) agendarSociosSemId(client);

    // Canal "IDs sem Discord": aqui não importa o cargo SÓCIO, só se o ID
    // vinculado ao apelido mudou — de qualquer membro (recém-vinculado some
    // da lista, apelido trocado sem ID some junto).
    if (idMudou) agendarIdsSemSocio(client);
  },
};
