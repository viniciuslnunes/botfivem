const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const config = require('../../config/index.js');
const { registrarModulo } = require('../modulos');
const { ehRecrutadorOuAcima, ehSocioOuAcima } = require('../permissoes');
const repo = require('./repositorio');
const { validarTexto, TEXTO_MIN, TEXTO_MAX } = require('./regras');
const { montarSugestao, montarBotoesVoto, garantirPainelNoFim } = require('./painel');

// sug:nova (botão do painel) · sug:enviar (modal) · sug:votar:<id>:<A|C> (botões da sugestão)

async function abrirModal(interaction) {
  if (!ehRecrutadorOuAcima(interaction.member)) {
    return interaction.reply({ content: '❌ SÓ RECRUTADORES E ACIMA ENVIAM SUGESTÕES.', flags: 64 });
  }
  return interaction.showModal(new ModalBuilder()
    .setCustomId('sug:enviar')
    .setTitle('ENVIAR SUGESTÃO')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('texto').setLabel('SUA SUGESTÃO (PROCESSO OU DISCORD)').setStyle(TextInputStyle.Paragraph)
      .setRequired(true).setMinLength(TEXTO_MIN).setMaxLength(TEXTO_MAX))));
}

async function enviar(interaction) {
  // Permissão conferida de novo: o modal pode ter ficado aberto depois de perder o cargo
  if (!ehRecrutadorOuAcima(interaction.member)) {
    return interaction.reply({ content: '❌ SÓ RECRUTADORES E ACIMA ENVIAM SUGESTÕES.', flags: 64 });
  }
  const v = validarTexto(interaction.fields.getTextInputValue('texto'));
  if (!v.ok) return interaction.reply({ content: v.mensagem, flags: 64 });

  await interaction.deferReply({ flags: 64 });
  const canal = config.canais.sugestoes ? await interaction.client.channels.fetch(config.canais.sugestoes).catch(() => null) : null;
  if (!canal?.isTextBased()) return interaction.editReply({ content: '❌ O CANAL DE SUGESTÕES NÃO ESTÁ CONFIGURADO. AVISE A LIDERANÇA.' });

  const sugestao = await repo.criarSugestao({ autorId: interaction.user.id, texto: v.texto });
  const autorNome = interaction.member.displayName ?? interaction.user.username;
  let mensagem;
  try {
    mensagem = await canal.send(montarSugestao(sugestao, autorNome));
  } catch (err) {
    // "resolvido" só depois da ação ter funcionado: sem mensagem no canal, não fica registro
    await repo.apagarSugestao(sugestao.id);
    console.error('[sugestoes] erro ao publicar:', err.message);
    return interaction.editReply({ content: '❌ NÃO CONSEGUI PUBLICAR A SUGESTÃO. TENTE DE NOVO.' });
  }

  const thread = await mensagem.startThread?.({ name: `Tópico #${sugestao.id} - ${autorNome}`.slice(0, 100) }).catch(() => null);
  await repo.gravarPublicacao(sugestao.id, { mensagemId: mensagem.id, threadId: thread?.id ?? null });
  await garantirPainelNoFim(interaction.client);
  return interaction.editReply({ content: `✔️ SUGESTÃO **#${sugestao.id}** PUBLICADA: ${mensagem.url ?? `<#${canal.id}>`}` });
}

async function votar(interaction, id, voto) {
  if (!ehSocioOuAcima(interaction.member)) {
    return interaction.reply({ content: '❌ SÓ SÓCIOS E ACIMA VOTAM NAS SUGESTÕES.', flags: 64 });
  }
  if (voto !== 'A' && voto !== 'C') return interaction.reply({ content: '⚠️ VOTO INVÁLIDO.', flags: 64 });
  const sugestao = await repo.buscarSugestao(id);
  if (!sugestao) return interaction.reply({ content: '⚠️ SUGESTÃO NÃO ENCONTRADA.', flags: 64 });
  if (sugestao.autor_id === interaction.user.id) {
    return interaction.reply({ content: '❌ VOCÊ NÃO PODE VOTAR NA PRÓPRIA SUGESTÃO.', flags: 64 });
  }
  const contagem = await repo.votar(sugestao.id, interaction.user.id, voto);
  return interaction.update({ components: montarBotoesVoto(sugestao.id, contagem) });
}

registrarModulo('sug', async interaction => {
  const [, acao, id, voto] = interaction.customId.split(':');
  if (acao === 'nova') return abrirModal(interaction);
  if (acao === 'enviar') return enviar(interaction);
  if (acao === 'votar') return votar(interaction, id, voto);
});
