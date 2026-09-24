const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca } = require('../permissoes');
const { papelNaArea } = require('../departamentos/acesso');
const { avisarPorDM } = require('../eventos/interacoes');
const repo = require('./repositorio');
const { formatarDia } = require('./regras');
const { publicarFato } = require('./publicacao');
const tema = require('../../tema');

// Fato atrasado (dia que já passou) passa por aprovação: mem:aprovar:<id> · mem:rejeitar:<id> · mem:motivo:<id>

async function podeModerarMemoria(member) {
  return ehLideranca(member) || (await papelNaArea(member, 'comunicacao')) === 'gestor';
}

function montarCartaoAprovacao(fato) {
  return {
    embeds: [{
      color: tema.cor.aviso,
      title: `📜 MEMÓRIA ATRASADA PARA APROVAR — ${formatarDia(fato.dia_chave)}`,
      description: fato.texto,
      fields: [{ name: 'AUTOR', value: `<@${fato.autor_id}>`, inline: true }, { name: 'FATO', value: `#${fato.id}`, inline: true }],
    }],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`mem:aprovar:${fato.id}`).setLabel('APROVAR').setEmoji(tema.emoji.ok).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`mem:rejeitar:${fato.id}`).setLabel('REJEITAR').setStyle(ButtonStyle.Danger)
    )],
    allowedMentions: { parse: [] },
  };
}

async function finalizarCartao(interaction, texto) {
  const embed = interaction.message?.embeds?.[0];
  await interaction.message?.edit({
    embeds: embed ? [{ ...embed.data, color: tema.cor.primaria, footer: { text: texto } }] : [],
    components: [],
  }).catch(() => {});
}

registrarModulo('mem', async interaction => {
  const [, acao, fatoId] = interaction.customId.split(':');
  if (!(await podeModerarMemoria(interaction.member))) {
    return interaction.reply({ content: '❌ SÓ A LIDERANÇA OU O GESTOR DE COMUNICAÇÃO MODERA A MEMÓRIA.', flags: 64 });
  }

  if (interaction.isButton() && acao === 'aprovar') {
    await interaction.deferReply({ flags: 64 });
    const fato = await repo.decidirFato(fatoId, 'APROVADA', interaction.user.id);
    if (!fato) return interaction.editReply({ content: '⚠️ ESTE FATO JÁ FOI DECIDIDO.' });
    const mensagem = await publicarFato(interaction.client, fato);
    await finalizarCartao(interaction, `${tema.emoji.ok} Aprovado por ${interaction.user.tag}`);
    await avisarPorDM(interaction.client, fato.autor_id, { content: `📜 Sua memória de **${formatarDia(fato.dia_chave)}** foi aprovada e publicada: ${mensagem.url}` });
    return interaction.editReply({ content: `${tema.emoji.ok} PUBLICADO: ${mensagem.url}` });
  }

  if (interaction.isButton() && acao === 'rejeitar') {
    return interaction.showModal(new ModalBuilder()
      .setCustomId(`mem:motivo:${fatoId}`)
      .setTitle('REJEITAR MEMÓRIA')
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
        .setCustomId('motivo').setLabel('MOTIVO (VAI PARA O AUTOR)').setStyle(TextInputStyle.Paragraph)
        .setRequired(true).setMinLength(10).setMaxLength(500))));
  }

  if (interaction.isModalSubmit() && acao === 'motivo') {
    const motivo = interaction.fields.getTextInputValue('motivo').trim();
    const fato = await repo.decidirFato(fatoId, 'REJEITADA', interaction.user.id, motivo);
    if (!fato) return interaction.reply({ content: '⚠️ ESTE FATO JÁ FOI DECIDIDO.', flags: 64 });
    await finalizarCartao(interaction, `❌ Rejeitado por ${interaction.user.tag}: ${motivo}`);
    await avisarPorDM(interaction.client, fato.autor_id, { content: `📜 Sua memória de **${formatarDia(fato.dia_chave)}** não foi publicada. Motivo: ${motivo}` });
    return interaction.reply({ content: '❌ MEMÓRIA REJEITADA. O AUTOR FOI AVISADO.', flags: 64 });
  }
});

module.exports = { montarCartaoAprovacao, podeModerarMemoria };
