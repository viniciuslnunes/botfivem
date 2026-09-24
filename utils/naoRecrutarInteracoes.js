// Não recrutar: validar, bloquear e desbloquear ID do jogo (botões e modais).
// Veio do antigo events/interactionCreate.js sem mudar a lógica; cada customId
// continua o mesmo, agora roteado por utils/modulos.js.
const config = require('../config/index.js');
const { buscarBloqueio, mensagensDoBloqueio, invalidarCacheBloqueios } = require('./naoRecrutar');
const { mapearSociosPorIdFivem } = require('./recrutamento/funil');
const { garantirMembrosCarregados } = require('./membrosGuild');
const tema = require('../tema');
const { registrarModulo } = require('./modulos');

// abrir_bloquearid
registrarModulo('abrir_bloquearid', async interaction => {
  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
  const modal = new ModalBuilder()
    .setCustomId('modal_bloquearid')
    .setTitle('BLOQUEAR NOVO ID — NÃO RECRUTAR');
  const idInput = new TextInputBuilder()
    .setCustomId('id')
    .setLabel('ID FIVEM PARA BLOQUEAR')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(8);
  const motivoInput = new TextInputBuilder()
    .setCustomId('motivo')
    .setLabel('MOTIVO DO BLOQUEIO')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(100);
  const provaInput = new TextInputBuilder()
    .setCustomId('prova')
    .setLabel('PROVA (OPCIONAL, LINK OU INFO)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(100);
  modal.addComponents(
    new ActionRowBuilder().addComponents(idInput),
    new ActionRowBuilder().addComponents(motivoInput),
    new ActionRowBuilder().addComponents(provaInput)
  );
  await interaction.showModal(modal);
  return;
});

// abrir_desbloquearid
registrarModulo('abrir_desbloquearid', async interaction => {
  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
  const modal = new ModalBuilder()
    .setCustomId('modal_desbloquearid')
    .setTitle('REMOVER ID BLOQUEADO — NÃO RECRUTAR');
  const idInput = new TextInputBuilder()
    .setCustomId('id')
    .setLabel('ID FIVEM PARA DESBLOQUEAR')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(8);
  const motivoInput = new TextInputBuilder()
    .setCustomId('motivo')
    .setLabel('MOTIVO DA REMOÇÃO')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(100);
  modal.addComponents(
    new ActionRowBuilder().addComponents(idInput),
    new ActionRowBuilder().addComponents(motivoInput)
  );
  await interaction.showModal(modal);
  return;
});

// abrir_validarid
registrarModulo('abrir_validarid', async interaction => {
  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
  const modal = new ModalBuilder()
    .setCustomId('modal_validarid')
    .setTitle('VALIDAR ID — NÃO RECRUTAR');
  const idInput = new TextInputBuilder()
    .setCustomId('id_fivem')
    .setLabel('ID FIVEM PARA VALIDAR')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(8);
  modal.addComponents(new ActionRowBuilder().addComponents(idInput));
  await interaction.showModal(modal);
  return;
});

// modal_validarid
registrarModulo('modal_validarid', async interaction => {
  const { client } = interaction;
  const id_fivem = interaction.fields.getTextInputValue('id_fivem').trim();
  // O histórico inteiro é lido (pode levar alguns segundos): deferir antes
  await interaction.deferReply({ flags: 64 });
  let bloqueado;
  try {
    bloqueado = await buscarBloqueio(client, id_fivem);
  } catch (err) {
    console.error('Erro ao buscar histórico de não recrutar:', err);
    return interaction.editReply({ content: '❌ NÃO FOI POSSÍVEL CONSULTAR A LISTA DE NÃO RECRUTAR. TENTE NOVAMENTE.' });
  }
  if (bloqueado) {
    await interaction.editReply({
      content: `❌ O ID FiveM **${id_fivem}** está bloqueado para recrutamento!`,
      embeds: [bloqueado]
    });
  } else {
    await interaction.editReply({
      content: `🦅 O ID FiveM **${id_fivem}** está **liberado** para recrutamento!`
    });
  }
  return;
});

// modal_bloquearid
registrarModulo('modal_bloquearid', async interaction => {
  const id = interaction.fields.getTextInputValue('id');
  const motivo = interaction.fields.getTextInputValue('motivo');
  const prova = interaction.fields.getTextInputValue('prova');
  const canalHistorico = interaction.guild.channels.cache.get(config.canais.historicoNaoRecrutar);
  if (!canalHistorico || !canalHistorico.isTextBased()) {
    return interaction.reply({ content: 'Canal de histórico não encontrado.', flags: 64 });
  }
  await interaction.deferReply({ flags: 64 });
  // Bloqueio barra quem quer entrar; sócio ativo precisa ser desligado antes (atos separados, rastro separado)
  await garantirMembrosCarregados(interaction.guild).catch(() => {});
  const socioComId = mapearSociosPorIdFivem(interaction.guild.members.cache.values(), config.cargos.socio).get(id.trim());
  if (socioComId) {
    return interaction.editReply({
      content: `❌ O ID ${id.trim()} É DE ${socioComId}, SÓCIO ATIVO. DESLIGUE (REMOVA O CARGO SÓCIO) ANTES DE BLOQUEAR.`,
      allowedMentions: { parse: [] },
    });
  }
  const embed = {
    color: tema.cor.perigo,
    title: '❌ ID Bloqueado para Recrutamento',
    fields: [
      { name: 'ID', value: id, inline: false },
      { name: 'Motivo', value: motivo, inline: false },
      { name: 'Prova', value: prova || 'Não informado', inline: false },
      { name: 'Autor', value: `<@${interaction.user.id}>`, inline: false },
      { name: 'Data', value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: false }
    ]
  };
  await canalHistorico.send({ embeds: [embed] });
  invalidarCacheBloqueios();
  await interaction.editReply({ content: `ID ${id} bloqueado com sucesso!` });
  return;
});

// modal_desbloquearid
registrarModulo('modal_desbloquearid', async interaction => {
  const { client } = interaction;
  const id = interaction.fields.getTextInputValue('id').trim();
  const motivo = interaction.fields.getTextInputValue('motivo');
  await interaction.deferReply({ flags: 64 });

  // Mesma leitura da validação: o histórico inteiro do canal
  let bloqueios;
  try {
    bloqueios = (await mensagensDoBloqueio(client, id)).filter(msg => msg.author.id === client.user.id);
  } catch (err) {
    console.error('Erro ao buscar histórico de não recrutar:', err);
    return interaction.editReply({ content: '❌ Erro ao buscar o histórico de não recrutar.' });
  }
  if (bloqueios.length === 0) {
    return interaction.editReply({ content: `⚠️ O ID FiveM **${id}** não está na lista de não recrutar.` });
  }

  // Mantém o registro no histórico: renomeia o campo "ID" (a validação deixa de encontrá-lo)
  // e acrescenta quem removeu, o motivo e a data
  for (const msg of bloqueios) {
    const original = msg.embeds[0];
    const embed = {
      color: tema.cor.neutro,
      title: '🦅 ID Desbloqueado para Recrutamento',
      fields: [
        ...original.fields.map(f => f.name === 'ID' ? { ...f, name: 'ID (DESBLOQUEADO)' } : f),
        { name: 'Motivo da remoção', value: motivo, inline: false },
        { name: 'Removido por', value: `<@${interaction.user.id}>`, inline: false },
        { name: 'Data da remoção', value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: false }
      ]
    };
    await msg.edit({ embeds: [embed] });
  }
  invalidarCacheBloqueios();
  await interaction.editReply({ content: `🦅 ID ${id} removido da lista de não recrutar!` });
  return;
});
