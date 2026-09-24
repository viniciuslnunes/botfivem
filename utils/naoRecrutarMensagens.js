const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config/index.js');

// Botões nos canais de validar ID e de não recrutar: qualquer mensagem de
// gente (não bot) nesses canais recebe a resposta com o botão que abre o modal
// (o handler do botão está em naoRecrutarInteracoes.js). Não consome a mensagem.
function registrarFalha(err) {
  console.error('[nao-recrutar] Erro ao responder:', err);
}

async function aoMensagem(message) {
  // Botão para validar ID no canal 📝・validar-id
  if (message.channelId === config.canais.validarId && !message.author.bot) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('abrir_validarid')
        .setLabel('Validar ID')
        .setStyle(ButtonStyle.Secondary)
    );
    message.reply({ content: 'Clique para validar um ID:', components: [row] }).catch(registrarFalha);
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
    message.reply({ content: 'Clique para bloquear ou remover um ID:', components: [row] }).catch(registrarFalha);
  }
}

module.exports = { aoMensagem };
