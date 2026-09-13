const {
  ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, LabelBuilder,
} = require('discord.js');
const config = require('../../config/index.js');
const { registrarModulo } = require('../modulos');
const fichas = require('./fichas');
const regras = require('./regras');
const { decisaoEmAndamento, travarFicha, liberarFicha } = require('./trava');
const { registrarSinal } = require('../confianca/servico');
const { agendarAtualizacaoReativa: agendarAtualizacaoReprovados } = require('./painelReenvio');

const MSG_JA_ANALISADA = '⚠️ ESTA SOLICITAÇÃO JÁ ESTÁ SENDO (OU JÁ FOI) ANALISADA POR OUTRO RECRUTADOR.';

// Modal precisa abrir em até 3s: consulta lenta ao banco não pode travar o recrutamento
function comPrazo(promessa, ms, reserva) {
  return Promise.race([
    promessa.catch(err => {
      console.error('[recrutamento] Consulta falhou:', err);
      return reserva;
    }),
    new Promise(resolve => setTimeout(() => resolve(reserva), ms)),
  ]);
}

function montarModalRecrutamento() {
  const modal = new ModalBuilder()
    .setCustomId('modal_recrutamento')
    .setTitle('Formulário de Recrutamento');
  const nomeInput = new TextInputBuilder()
    .setCustomId('nome')
    .setLabel('Nome')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(16); // Limite para garantir nick válido
  const idadeInput = new TextInputBuilder()
    .setCustomId('idade')
    .setLabel('Idade (apenas números)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(2);
  const idFiveMInput = new TextInputBuilder()
    .setCustomId('id_fivem')
    .setLabel('ID FiveM (apenas números)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(6); // Limite de 6 dígitos para garantir nick válido
  const telefoneInput = new TextInputBuilder()
    .setCustomId('telefone')
    .setLabel('Telefone (apenas números, ex: 11912345678)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(11);
  const recrutadorInput = new TextInputBuilder()
    .setCustomId('recrutador')
    .setLabel('Recrutador')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(32);
  modal.addComponents(
    new ActionRowBuilder().addComponents(nomeInput),
    new ActionRowBuilder().addComponents(idadeInput),
    new ActionRowBuilder().addComponents(idFiveMInput),
    new ActionRowBuilder().addComponents(telefoneInput),
    new ActionRowBuilder().addComponents(recrutadorInput)
  );
  return modal;
}

// Botão SOLICITAR RECRUTAMENTO: confere se pode abrir ficha e abre o formulário
async function abrirRecrutamento(interaction) {
  if (interaction.member?.roles.cache.has(config.cargos.socio)) {
    return interaction.reply({ content: '🦅 VOCÊ JÁ É SÓCIO DA TORCIDA.', flags: 64 });
  }

  const situacao = await comPrazo(fichas.situacaoDoCandidato(interaction.user.id), 1500, null);
  const avaliacao = regras.avaliarNovaSolicitacao(situacao);
  if (!avaliacao.ok) return interaction.reply({ content: avaliacao.mensagem, flags: 64 });

  return interaction.showModal(montarModalRecrutamento());
}

// Botão REPROVAR: abre o laudo (categoria, reenvio e justificativa numa tela só)
async function abrirLaudoReprovacao(interaction) {
  const fichaId = interaction.message.id;
  if (decisaoEmAndamento(fichaId) || interaction.message.components.length === 0) {
    return interaction.reply({ content: MSG_JA_ANALISADA, flags: 64 });
  }
  const modal = new ModalBuilder()
    .setCustomId(`recrut:reprovar:${fichaId}`)
    .setTitle('REPROVAR RECRUTAMENTO');
  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Categoria')
      .setDescription('O que impede a aprovação')
      .setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId('categoria')
          .setPlaceholder('Selecione a categoria')
          .addOptions(regras.CATEGORIAS_REPROVACAO.map(c => ({ label: c.label, value: c.id })))
      ),
    new LabelBuilder()
      .setLabel('Pode tentar de novo?')
      .setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId('reenvio')
          .addOptions([
            { label: 'Sim — pode enviar nova solicitação', value: 'sim', default: true },
            { label: 'Não — reprovação definitiva', value: 'nao' },
          ])
      ),
    new LabelBuilder()
      .setLabel('Justificativa')
      .setDescription(`Vai para o candidato por DM (${regras.JUSTIFICATIVA_MIN} a ${regras.JUSTIFICATIVA_MAX} caracteres)`)
      .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId('justificativa')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(regras.JUSTIFICATIVA_MIN)
          .setMaxLength(regras.JUSTIFICATIVA_MAX)
      )
  );
  return interaction.showModal(modal);
}

async function avisarCandidato(client, discordId, { rotulo, justificativa, permiteReenvio }) {
  try {
    const usuario = await client.users.fetch(discordId);
    await usuario.send({
      embeds: [{
        color: 0xFF0000,
        title: '❌ RECRUTAMENTO — GAVIÕES DA FIEL FIVEM',
        description: 'Sua solicitação de recrutamento foi **reprovada**.',
        fields: [
          { name: 'MOTIVO', value: rotulo, inline: false },
          { name: 'JUSTIFICATIVA', value: justificativa, inline: false },
          {
            name: 'E AGORA?',
            value: permiteReenvio
              ? 'Você pode corrigir o que foi apontado e enviar uma nova solicitação.'
              : 'A reprovação é definitiva. Se discordar, abra um ticket.',
            inline: false,
          },
        ],
      }],
    });
    return true;
  } catch {
    return false;
  }
}

async function processarReprovacao(interaction, fichaId) {
  if (!travarFicha(fichaId)) return interaction.reply({ content: MSG_JA_ANALISADA, flags: 64 });
  try {
    await interaction.deferReply({ flags: 64 });

    const laudo = regras.validarLaudo({
      categoria: interaction.fields.getStringSelectValues('categoria')[0],
      justificativa: interaction.fields.getTextInputValue('justificativa'),
    });
    if (!laudo.ok) return interaction.editReply({ content: laudo.mensagem });
    const permiteReenvio = interaction.fields.getStringSelectValues('reenvio')[0] !== 'nao';

    const canal = await interaction.client.channels.fetch(config.canais.validarSetagem).catch(() => null);
    const mensagem = canal ? await canal.messages.fetch(fichaId).catch(() => null) : null;
    if (!mensagem) return interaction.editReply({ content: '❌ FICHA DE RECRUTAMENTO NÃO ENCONTRADA.' });
    if (mensagem.components.length === 0) return interaction.editReply({ content: MSG_JA_ANALISADA });

    const embedOriginal = mensagem.embeds[0];
    const dados = regras.lerFichaDoEmbed(embedOriginal.fields);
    const rotulo = regras.rotuloCategoria(laudo.categoria);

    if (dados.discordId) {
      const candidato = await interaction.guild.members.fetch(dados.discordId).catch(() => null);
      if (candidato) {
        if (config.cargos.provarManto) await candidato.roles.remove(config.cargos.provarManto).catch(() => {});
        if (config.cargos.visitante) await candidato.roles.remove(config.cargos.visitante).catch(() => {});
        if (config.cargos.reprovadoRecrutamento) await candidato.roles.add(config.cargos.reprovadoRecrutamento).catch(() => {});
      }
    }

    await mensagem.edit({
      content: null,
      embeds: [{
        title: embedOriginal.title || 'Recrutamento',
        description: embedOriginal.description || '',
        fields: [
          ...embedOriginal.fields,
          { name: 'Status', value: `❌ Reprovado por <@${interaction.user.id}>`, inline: false },
          { name: 'CATEGORIA', value: rotulo, inline: true },
          { name: 'PODE TENTAR DE NOVO', value: permiteReenvio ? 'SIM' : 'NÃO — DEFINITIVA', inline: true },
          { name: 'JUSTIFICATIVA', value: laudo.justificativa, inline: false },
        ],
        color: 0xFF0000,
      }],
      components: [],
    });

    await fichas.decidirFicha(fichaId, {
      status: 'REPROVADO',
      decididoPorId: interaction.user.id,
      categoria: laudo.categoria,
      motivo: laudo.justificativa,
      permiteReenvio,
    }, embedOriginal).catch(err => console.error('[recrutamento] Erro ao registrar reprovação:', err));
    if (!permiteReenvio) agendarAtualizacaoReprovados(interaction.client);
    if (dados.discordId) {
      await registrarSinal(interaction.client, { discordId: dados.discordId, sinal: 'REPROVACAO', origemTipo: 'ficha', origemId: fichaId })
        .catch(err => console.error('[recrutamento] Erro ao registrar sinal de confiança:', err));
    }

    const avisado = dados.discordId
      ? await avisarCandidato(interaction.client, dados.discordId, { rotulo, justificativa: laudo.justificativa, permiteReenvio })
      : false;
    return interaction.editReply({
      content: `❌ RECRUTAMENTO REPROVADO.${avisado ? ' O CANDIDATO RECEBEU A JUSTIFICATIVA POR DM.' : ' ⚠️ NÃO FOI POSSÍVEL AVISAR O CANDIDATO POR DM (DM FECHADA).'}`,
    });
  } finally {
    liberarFicha(fichaId);
  }
}

registrarModulo('recrut', async interaction => {
  const [, acao, alvo] = interaction.customId.split(':');
  if (acao === 'reprovar' && interaction.isModalSubmit()) {
    return processarReprovacao(interaction, alvo);
  }
});

module.exports = { montarModalRecrutamento, abrirRecrutamento, abrirLaudoReprovacao };
