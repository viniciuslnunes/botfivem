// Advertência de recrutador: cargos próprios, nunca os ADV de sócio.
// Veio do antigo events/interactionCreate.js sem mudar a lógica; cada customId
// continua o mesmo, agora roteado por utils/modulos.js.
const config = require('../../config/index.js');
const { agendar } = require('../agendador');
const tema = require('../../tema');
const { registrarModulo } = require('../modulos');

// Advertência de recrutador tem cargos próprios; reusar os de sócio escalaria as duas juntas.
const advRecConfigurada = () =>
  Array.isArray(config.cargos.advRec) && config.cargos.advRec.length === 3 && config.cargos.advRec.every(Boolean);
const MSG_ADV_REC_SEM_CARGOS = '⚠️ CARGOS DE ADVERTÊNCIA DE RECRUTADOR NÃO CONFIGURADOS. PEÇA A UM ADMINISTRADOR PARA PREENCHER `cargos.advRec` NA CONFIGURAÇÃO DO BOT.';

// abrir_registrar_adv_rec
registrarModulo('abrir_registrar_adv_rec', async interaction => {
  if (!advRecConfigurada()) return interaction.reply({ content: MSG_ADV_REC_SEM_CARGOS, flags: 64 });
  const { UserSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
  const row = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('select_membro_adv_rec_registrar')
      .setPlaceholder('SELECIONE O RECRUTADOR PARA ADVERTIR')
  );
  await interaction.reply({ content: '**⛔ REGISTRAR ADVERTÊNCIA DE RECRUTADOR** — SELECIONE O MEMBRO:', components: [row], flags: 64 });
  return;
});

// abrir_remover_adv_rec
registrarModulo('abrir_remover_adv_rec', async interaction => {
  if (!advRecConfigurada()) return interaction.reply({ content: MSG_ADV_REC_SEM_CARGOS, flags: 64 });
  const { UserSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
  const row = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('select_membro_adv_rec_remover')
      .setPlaceholder('SELECIONE O RECRUTADOR PARA REMOVER ADVERTÊNCIA')
  );
  await interaction.reply({ content: '**🦅 REMOVER ADVERTÊNCIA DE RECRUTADOR** — SELECIONE O MEMBRO:', components: [row], flags: 64 });
  return;
});

// select_membro_adv_rec_registrar
registrarModulo('select_membro_adv_rec_registrar', async interaction => {
  const { StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
  const membroId = interaction.values[0];
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`select_prazo_adv_rec:${membroId}`)
      .setPlaceholder('SELECIONE O PRAZO DE PAGAMENTO')
      .addOptions([
        { label: '⚙️ TESTE (1 SEGUNDO)', value: 'test' },
        { label: '1 DIA', value: '1' },
        { label: '2 DIAS', value: '2' },
        { label: '3 DIAS', value: '3' },
      ])
  );
  await interaction.reply({ content: '**⛔ REGISTRAR ADVERTÊNCIA DE RECRUTADOR** — SELECIONE O PRAZO DE PAGAMENTO:', components: [row], flags: 64 });
  return;
});

// select_prazo_adv_rec:…
registrarModulo('select_prazo_adv_rec', async interaction => {
  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
  const membroId = interaction.customId.split(':')[1];
  const prazo = interaction.values[0];
  const modal = new ModalBuilder()
    .setCustomId(`modal_registrar_adv_rec:${membroId}:${prazo}`)
    .setTitle('REGISTRAR ADVERTÊNCIA — RECRUTADOR');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('motivo').setLabel('MOTIVO DA ADVERTÊNCIA').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(300)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('punicao').setLabel('PUNIÇÃO APLICADA').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('prova').setLabel('PROVA (OPCIONAL, LINK OU DESCRIÇÃO)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200)
    )
  );
  await interaction.showModal(modal);
  return;
});

// select_membro_adv_rec_remover
registrarModulo('select_membro_adv_rec_remover', async interaction => {
  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
  const membroId = interaction.values[0];
  const modal = new ModalBuilder()
    .setCustomId(`modal_remover_adv_rec:${membroId}`)
    .setTitle('REMOVER ADVERTÊNCIA — RECRUTADOR');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('motivo').setLabel('MOTIVO DA REMOÇÃO').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(300)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('prova').setLabel('PROVA (OPCIONAL, LINK OU DESCRIÇÃO)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200)
    )
  );
  await interaction.showModal(modal);
  return;
});

// modal_registrar_adv_rec:…
registrarModulo('modal_registrar_adv_rec', async interaction => {
      const parts    = interaction.customId.split(':');
      const membroId = parts[1];
      const prazoRaw = parts[2];
      const isTeste  = prazoRaw === 'test';
      const prazoNum = isTeste ? 0 : parseInt(prazoRaw);
      const prazoMs  = isTeste ? 1000 : prazoNum * 24 * 60 * 60 * 1000;
      const prazoLabel = isTeste ? '⚙️ TESTE (1 SEGUNDO)' : prazoNum === 1 ? '1 DIA' : `${prazoNum} DIAS`;
      const motivo   = interaction.fields.getTextInputValue('motivo');
      const punicao  = interaction.fields.getTextInputValue('punicao');
      const prova    = interaction.fields.getTextInputValue('prova') || null;

      let membro;
      try {
        membro = await interaction.guild.members.fetch(membroId);
      } catch {
        return interaction.reply({ content: `❌ MEMBRO NÃO ENCONTRADO NO SERVIDOR.`, flags: 64 });
      }

      if (!advRecConfigurada()) {
        return interaction.reply({ content: MSG_ADV_REC_SEM_CARGOS, flags: 64 });
      }

      const CANAL_HISTORICO_REC = config.canais.historicoAdvRec;
      const CARGOS_ADV = config.cargos.advRec; // ADV¹/²/³ de recrutador

      const advAtual  = CARGOS_ADV.findIndex(id => membro.roles.cache.has(id));
      const proximaAdv = advAtual + 1;

      if (proximaAdv >= CARGOS_ADV.length) {
        return interaction.reply({ content: `⚠️ ${membro} JÁ POSSUI A **3ª ADVERTÊNCIA** (MÁXIMO ATINGIDO).`, flags: 64 });
      }

      if (advAtual >= 0) await membro.roles.remove(CARGOS_ADV[advAtual]).catch(() => {});
      await membro.roles.add(CARGOS_ADV[proximaAdv]);

      const numAdv   = proximaAdv + 1;
      const expiraEm = Math.floor(Date.now() / 1000) + prazoNum * 86400;

      const embedRec = {
        color: tema.cor.perigo,
        title: `❌ ADV. RECRUTAMENTO ${numAdv}ª REGISTRADA`,
        fields: [
          { name: 'RECRUTADOR', value: `<@${membro.id}>`, inline: true },
          { name: 'ADVERTÊNCIA', value: `${numAdv}ª`, inline: true },
          { name: 'MOTIVO', value: motivo, inline: false },
          { name: 'PUNIÇÃO', value: punicao, inline: false },
          { name: 'PRAZO DE PAGAMENTO', value: `${prazoLabel} — <t:${expiraEm}:F>`, inline: false },
          { name: 'PROVA', value: prova || 'NÃO INFORMADA', inline: false },
          { name: 'REGISTRADO POR', value: `<@${interaction.user.id}>`, inline: false },
          { name: 'DATA', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
        ],
        footer: { text: '⚠️ O NÃO PAGAMENTO DENTRO DO PRAZO RESULTARÁ NA PERDA DO CARGO DE RECRUTADOR.' }
      };

      const canalHistRec = interaction.guild.channels.cache.get(CANAL_HISTORICO_REC);
      if (canalHistRec) await canalHistRec.send({ embeds: [embedRec] });

      await interaction.reply({ content: `🦅 **${numAdv}ª ADVERTÊNCIA DE RECRUTAMENTO** REGISTRADA PARA ${membro}. PRAZO: **${prazoLabel}** (<t:${expiraEm}:F>).
> ⚠️ O NÃO PAGAMENTO DENTRO DO PRAZO RESULTARÁ NA PERDA DO CARGO DE RECRUTADOR.`, flags: 64 });

      // Vencimento pelo agendador persistente: sobrevive a reinício do bot
      try {
        await agendar('adv_vencimento', new Date(Date.now() + prazoMs), {
          variante: 'recrutador', membroId, cargoAdv: CARGOS_ADV[proximaAdv], numAdv, motivo, punicao, prazoLabel, expiraEm,
        });
      } catch (err) {
        console.error('[adv_rec] Erro ao agendar vencimento:', err);
        await interaction.followUp({ content: '⚠️ A ADVERTÊNCIA FOI REGISTRADA, MAS O VENCIMENTO AUTOMÁTICO NÃO FOI AGENDADO. ACOMPANHE O PRAZO MANUALMENTE.', flags: 64 }).catch(() => {});
      }

      return;
});

// modal_remover_adv_rec:…
registrarModulo('modal_remover_adv_rec', async interaction => {
  const membroId = interaction.customId.split(':')[1];
  const motivo   = interaction.fields.getTextInputValue('motivo');
  const prova    = interaction.fields.getTextInputValue('prova') || null;

  let membro;
  try {
    membro = await interaction.guild.members.fetch(membroId);
  } catch {
    return interaction.reply({ content: `❌ MEMBRO NÃO ENCONTRADO NO SERVIDOR.`, flags: 64 });
  }

  if (!advRecConfigurada()) {
    return interaction.reply({ content: MSG_ADV_REC_SEM_CARGOS, flags: 64 });
  }

  const CANAL_HISTORICO_REC = config.canais.historicoAdvRec;
  const CARGOS_ADV = config.cargos.advRec; // ADV¹/²/³ de recrutador

  const advAtual = CARGOS_ADV.findIndex(id => membro.roles.cache.has(id));

  if (advAtual === -1) {
    return interaction.reply({ content: `⚠️ ${membro} NÃO POSSUI NENHUMA ADVERTÊNCIA REGISTRADA.`, flags: 64 });
  }

  await membro.roles.remove(CARGOS_ADV[advAtual]);
  if (advAtual > 0) await membro.roles.add(CARGOS_ADV[advAtual - 1]);

  const numAdv = advAtual + 1;
  const embedRemRec = {
    color: tema.cor.primaria,
    title: `🦅 ADV. RECRUTAMENTO ${numAdv}ª REMOVIDA`,
    fields: [
      { name: 'RECRUTADOR', value: `<@${membro.id}>`, inline: true },
      { name: 'ADVERTÊNCIA REMOVIDA', value: `${numAdv}ª`, inline: true },
      { name: 'MOTIVO', value: motivo, inline: false },
      { name: 'PROVA', value: prova || 'NÃO INFORMADA', inline: false },
      { name: 'REMOVIDO POR', value: `<@${interaction.user.id}>`, inline: false },
      { name: 'DATA', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
    ]
  };

  const canalHistRec = interaction.guild.channels.cache.get(CANAL_HISTORICO_REC);
  if (canalHistRec) await canalHistRec.send({ embeds: [embedRemRec] });

  await interaction.reply({ content: `🦅 **${numAdv}ª ADVERTÊNCIA DE RECRUTAMENTO** REMOVIDA DE ${membro}.`, flags: 64 });
  return;
});
