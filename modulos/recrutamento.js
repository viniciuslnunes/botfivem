module.exports = {
  id: 'recrutamento',
  descricao: 'Recrutamento: formulário, análise e aprovação, funil, reenvio, convite do WhatsApp e quadros de recrutadores',
  padrao: true,
  requer: ['departamentos', 'confianca', 'logsJogo', 'bloqueioId'],
  exige: {
    canais: ['recrutamento', 'provarManto', 'validarSetagem', 'quadroRecrutadores', 'topRecrutadores', 'alertaNovatos', 'telefoneSocio'],
    links: ['whatsappSocios'],
  },
  comandos: ['enviarrecrutamento', 'quadrorecrutadores', 'toprecrutadores', 'convitewhatsapp'],
  carregar() {
    require('../utils/recrutamento/interacoes'); // formulário, aprovar, reprovar (traz o prefixo "recrut")
    require('../utils/recrutamento/painelReenvio'); // prefixo "reenvio"
    require('../utils/recrutamento/painelConviteWhatsapp'); // prefixo "convitewa"
    require('../utils/recrutamento/painelManto'); // prefixo "mantoaval" (avaliar foto do manto)
  },

  // Foto no provar-manto ganha botões de correto/errado (não consome a mensagem)
  // Post no canal de divulgação entra na sequência de recrutamento (também não consome)
  async aoMensagem(message) {
    await require('../utils/recrutamento/painelDivulgacao').aoMensagem(message);
    return require('../utils/recrutamento/painelManto').aoMensagem(message);
  },

  aoIniciar(client) {
    const { iniciarAlertaNovatos } = require('../utils/recrutamento/alertaNovatos');
    const { iniciarPainelReenvio } = require('../utils/recrutamento/painelReenvio');
    const { iniciarPainelConviteWhatsapp } = require('../utils/recrutamento/painelConviteWhatsapp');
    const { iniciarPainelManto } = require('../utils/recrutamento/painelManto');
    const { iniciarPainelDivulgacao } = require('../utils/recrutamento/painelDivulgacao');
    const { garantirMensagemRecrutamento } = require('../utils/recrutamento/mensagemFixa');

    // Novatos do jogo que não pediram recrutamento no Discord (a cada 6h).
    // O alerta automático de sede/portão destrancados foi desativado
    // (2026-09-15): poluía o canal de novatos; o estado sob demanda continua
    // em /estatisticas seguranca e no painel de fechaduras.
    iniciarAlertaNovatos(client);
    // Reprovados sem nova tentativa, com o botão de liberar (abaixo do validar-setagem)
    iniciarPainelReenvio(client);
    // Convite do grupo de sócios no WhatsApp: enviar pra um ou todos, e trocar o link
    iniciarPainelConviteWhatsapp(client);
    // Placar de acertos/erros de manto por recrutador (canal só da liderança)
    iniciarPainelManto(client);
    // Quem pode divulgar recrutamento + sequência dos posts (canais.divulgacaoRecrutamento null = desligado)
    iniciarPainelDivulgacao(client);
    // Mensagem fixa de recrutamento no canal de análise (somente se não existir)
    return garantirMensagemRecrutamento(client);
  },

  // Quadro de recrutadores em dia quando alguém ganha ou perde o cargo RECRUTADOR
  async aoMembroAtualizado(antes, depois, client) {
    const {
      atualizarQuadroRecrutadores, registrarEntradaNoCargo, removerEntradaNoCargo, CARGO_RECRUTADOR,
    } = require('../utils/quadroRecrutadores');
    const tinha = antes.roles.cache.has(CARGO_RECRUTADOR);
    const tem = depois.roles.cache.has(CARGO_RECRUTADOR);
    if (tinha === tem) return;
    try {
      if (tem) await registrarEntradaNoCargo(depois.id);
      else await removerEntradaNoCargo(depois.id);
    } catch (err) {
      console.error('[recrutamento] Erro ao registrar data do cargo RECRUTADOR:', err.message);
    }
    await atualizarQuadroRecrutadores(client);
  },
};
