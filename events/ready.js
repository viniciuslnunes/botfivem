// Handler de eventos: ready
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../config/index.js');
const { executarMigracoes } = require('../utils/migracoes');
const { iniciarAgendador } = require('../utils/agendador');
const { sincronizarCanaisDeLog } = require('../utils/logsJogo/ingestao');
const { iniciarPainelLogs } = require('../utils/logsJogo/painel');
const { iniciarPainelJogadores } = require('../utils/logsJogo/painelJogadores');
const { reconciliarCarteirinhas } = require('../utils/carteirinhaSocio');
const { iniciarVerificacaoVencimentos } = require('../utils/carteirinha/vencimentos');
const { iniciarAlertaNovatos } = require('../utils/recrutamento/alertaNovatos');
const { atualizarQuadroDepartamentos } = require('../utils/departamentos/quadro');
const { garantirMensagemNaoRecrutar } = require('../utils/mensagemNaoRecrutar');

module.exports = (client) => {
  client.once('clientReady', async () => {
    console.log(`Bot online como ${client.user.tag}`);

    // Estrutura do banco antes de qualquer rotina que dependa dela
    await executarMigracoes();
    iniciarAgendador(client);

    // Recupera logs do jogo que chegaram com o bot desligado. Os painéis só
    // começam depois: postar antes mostraria tudo zerado até o backfill acabar.
    sincronizarCanaisDeLog(client)
      .then(resultados => console.log('[logs-jogo] Sincronização inicial:', resultados))
      .catch(err => console.error('[logs-jogo] Erro na sincronização inicial:', err))
      .finally(() => {
        iniciarPainelLogs(client);
        iniciarPainelJogadores(client);
      });

    // Carteirinhas de quem perdeu ou recuperou o cargo SÓCIO com o bot desligado
    reconciliarCarteirinhas(client)
      .then(alteradas => { if (alteradas) console.log(`[carteirinha] ${alteradas} carteirinha(s) reconciliada(s).`); })
      .catch(err => console.error('[carteirinha] Erro na reconciliação:', err));
    // Aviso por DM de carteirinha vencendo/vencida (a cada 6h)
    iniciarVerificacaoVencimentos(client);
    // Novatos do jogo que não pediram recrutamento no Discord (a cada 6h)
    iniciarAlertaNovatos(client);
    // Quadro de departamentos em dia com quem entrou/saiu das áreas com o bot desligado
    atualizarQuadroDepartamentos(client)
      .catch(err => console.error('[departamentos] Erro ao atualizar quadro:', err));
    // Mensagem fixa do não recrutar com os botões de bloquear e remover ID
    garantirMensagemNaoRecrutar(client)
      .catch(err => console.error('[nao-recrutar] Erro ao atualizar mensagem fixa:', err));

    // Enviar mensagem fixa de recrutamento no canal de análise (somente se não existir)
    try {
      const canalRecrutamento = await client.channels.fetch(config.canais.recrutamento);
      if (canalRecrutamento) {
        const msgs = await canalRecrutamento.messages.fetch({ limit: 20 });
        const jaExiste = msgs.some(m => m.author.id === client.user.id && m.components.length > 0);
        if (!jaExiste) {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('abrir_recrutamento')
              .setLabel('SOLICITAR RECRUTAMENTO')
              .setStyle(ButtonStyle.Secondary)
          );
          const embed = new EmbedBuilder()
            .setColor(0x000000)
            .setTitle('RECRUTAMENTO - GAVIÕES DA FIEL - FIVEM')
            .setDescription('Clique no botão abaixo para solicitar seu recrutamento!')
            .setThumbnail('attachment://gavioesdafielfivem_logo.png');
          await canalRecrutamento.send({
            embeds: [embed],
            components: [row],
            files: [{ attachment: './img/gavioesdafielfivem_logo.png', name: 'gavioesdafielfivem_logo.png' }]
          });
        }
      }
    } catch (err) {
      console.error('Erro ao enviar mensagem fixa de recrutamento:', err);
    }

    // Enviar mensagem fixa de ticket (somente se não existir)
    try {
      const canalTicket = await client.channels.fetch(config.canais.ticket);
      if (canalTicket) {
        const msgs = await canalTicket.messages.fetch({ limit: 20 });
        const jaExiste = msgs.some(m => m.author.id === client.user.id && m.components.length > 0);
        if (!jaExiste) {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('abrir_ticket')
              .setLabel('🎫 ABRIR TICKET')
              .setStyle(ButtonStyle.Secondary)
          );
          const embed = new EmbedBuilder()
            .setColor(0x000000)
            .setTitle('🎫 TICKET - GAVIÕES DA FIEL - FIVEM')
            .setDescription('Clique no botão abaixo para abrir um ticket e falar com a nossa equipe de suporte.')
            .setImage('attachment://FAIXA_19.jpg');
          await canalTicket.send({
            embeds: [embed],
            components: [row],
            files: [{ attachment: './img/FAIXA_19.jpg', name: 'FAIXA_19.jpg' }]
          });
        }
      }
    } catch (err) {
      console.error('Erro ao enviar mensagem fixa de ticket:', err);
    }
  });
};
