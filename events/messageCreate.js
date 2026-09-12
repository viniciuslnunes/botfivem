// Handler de eventos: messageCreate
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config/index.js');
const { ehMensagemDeLog, registrosDaMensagem, gravarRegistros } = require('../utils/logsJogo/ingestao');
const { avaliarAlertas } = require('../utils/logsJogo/alertas');
const { agendarAtualizacaoReativa, atualizarPainelJogadores } = require('../utils/logsJogo/painelJogadores');
const { agendarAtualizacaoReativa: agendarRegistrosDiarios } = require('../utils/logsJogo/registrosDiarios');
const { agendarAtualizacaoReativa: agendarIdsSemSocio } = require('../utils/logsJogo/idsSemSocio');
const { incrementarSociosManual } = require('../utils/logsJogo/presencaInteracoes');

module.exports = (client) => {
  client.on('messageCreate', async message => {
    // ── Logs do jogo (webhook do FiveM) ──────────────────────────────────────
    // O log continua no canal; o bot grava para filtros/estatísticas e avalia
    // os alertas (o de novato é o primeiro deles).
    if (ehMensagemDeLog(message)) {
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
      return;
    }
    // ────────────────────────────────────────────────────────────────────────
    if (message.content === '!ping') {
      message.reply('Pong!');
    }
    if (message.content === '!sociais') {
      message.channel.send({
        embeds: [
          {
            color: 0x000000,
            title: '🌐 REDES SOCIAIS DOS GAVIÕES DA FIEL - FIVEM',
            description: 'Acesse todas as nossas redes sociais aqui:\n\n[Clique aqui](https://linktr.ee/gavioesdafielfivem)',
            thumbnail: {
              url: 'attachment://gavioesdafielfivem_logo.png'
            }
          }
        ],
        files: [
          {
            attachment: './img/gavioesdafielfivem_logo.png',
            name: 'gavioesdafielfivem_logo.png'
          }
        ]
      });
    }
    if (message.content === '!parceiros') {
      const embed = {
        color: 0x000000,
        title: '🤝 PARCEIROS DOS GAVIÕES DA FIEL - FIVEM',
        description: 'A FIEL é gigante, e só cresce porque temos ao nosso lado parceiros que apoiam a nossa paixão pelo Corinthians.\nClique nos botões abaixo e conheça cada um deles!',
        image: {
          url: 'attachment://gavioesdafielfivem_logo.png'
        }
      };
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('BX STORE')
          .setStyle(ButtonStyle.Link)
          .setURL('https://discord.gg/gtbXKJamP4'),
        new ButtonBuilder()
          .setLabel('SCCP DISCORD')
          .setStyle(ButtonStyle.Link)
          .setURL('https://discord.gg/sccp'),
        new ButtonBuilder()
          .setLabel('FUT CORINTHIANS')
          .setStyle(ButtonStyle.Link)
          .setURL('https://www.tiktok.com/@fut_corinthians')
      );
      message.channel.send({
        embeds: [embed],
        components: [row],
        files: [
          {
            attachment: './img/gavioesdafielfivem_logo.png',
            name: 'gavioesdafielfivem_logo.png'
          }
        ]
      });
    }
    // Botão para validar ID no canal 📝・validar-id
    if (message.channelId === config.canais.validarId && !message.author.bot) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('abrir_validarid')
          .setLabel('Validar ID')
          .setStyle(ButtonStyle.Secondary)
      );
      message.reply({ content: 'Clique para validar um ID:', components: [row] });
    }
    // Botão para abrir formulário de bloqueio no canal ❌・nao-recrutar
    if (message.channelId === config.canais.naoRecrutar && !message.author.bot) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('abrir_bloquearid')
          .setLabel('Bloquear novo ID')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('abrir_desbloquearid')
          .setLabel('Remover ID bloqueado')
          .setStyle(ButtonStyle.Secondary)
      );
      message.reply({ content: 'Clique para bloquear ou remover um ID:', components: [row] });
    }
  });
};
