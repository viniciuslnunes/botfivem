// Advertência de sócio: registrar e remover (botão → select de membro → prazo → modal).
// Veio do antigo events/interactionCreate.js sem mudar a lógica; cada customId
// continua o mesmo, agora roteado por utils/modulos.js.
const config = require('../../config/index.js');
const { agendar } = require('../agendador');
const { verificarRestricaoAoAdvertir } = require('../logsJogo/alertas');
const tema = require('../../tema');
const { registrarModulo } = require('../modulos');

// abrir_registrar_advertencia
registrarModulo('abrir_registrar_advertencia', async interaction => {
  const { UserSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
  const row = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('select_membro_adv_registrar')
      .setPlaceholder('SELECIONE O MEMBRO PARA ADVERTIR')
  );
  await interaction.reply({ content: '**⛔ REGISTRAR ADVERTÊNCIA** — SELECIONE O MEMBRO:', components: [row], flags: 64 });
  return;
});

// abrir_remover_advertencia
registrarModulo('abrir_remover_advertencia', async interaction => {
  const { UserSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
  const row = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('select_membro_adv_remover')
      .setPlaceholder('SELECIONE O MEMBRO PARA REMOVER ADVERTÊNCIA')
  );
  await interaction.reply({ content: '**🦅 REMOVER ADVERTÊNCIA** — SELECIONE O MEMBRO:', components: [row], flags: 64 });
  return;
});

// select_membro_adv_registrar
registrarModulo('select_membro_adv_registrar', async interaction => {
  const { StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
  const membroId = interaction.values[0];
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`select_prazo_adv:${membroId}`)
      .setPlaceholder('SELECIONE O PRAZO DE PAGAMENTO')
      .addOptions([
        { label: '⚙️ TESTE (1 SEGUNDO)', value: 'test' },
        { label: '1 DIA', value: '1' },
        { label: '2 DIAS', value: '2' },
        { label: '3 DIAS', value: '3' },
      ])
  );
  await interaction.reply({ content: '**⛔ REGISTRAR ADVERTÊNCIA** — SELECIONE O PRAZO DE PAGAMENTO:', components: [row], flags: 64 });
  return;
});

// select_prazo_adv:…
registrarModulo('select_prazo_adv', async interaction => {
  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
  const membroId = interaction.customId.split(':')[1];
  const prazo = interaction.values[0];
  const modal = new ModalBuilder()
    .setCustomId(`modal_registrar_advertencia:${membroId}:${prazo}`)
    .setTitle('REGISTRAR ADVERTÊNCIA');
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

// select_membro_adv_remover
registrarModulo('select_membro_adv_remover', async interaction => {
  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
  const membroId = interaction.values[0];
  const modal = new ModalBuilder()
    .setCustomId(`modal_remover_advertencia:${membroId}`)
    .setTitle('REMOVER ADVERTÊNCIA');
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

// modal_registrar_advertencia:…
registrarModulo('modal_registrar_advertencia', async interaction => {
      const parts  = interaction.customId.split(':');
      const membroId = parts[1];
      const prazoRaw = parts[2]; // 'test', '1', '2' ou '3'
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

      const CANAL_HISTORICO = config.canais.historicoAdv;
      const CARGOS_ADV = config.cargos.adv; // ADV¹/²/³ de sócio

      // Verificar quantas advertências o membro já tem
      const advAtual = CARGOS_ADV.findIndex(id => membro.roles.cache.has(id));
      // advAtual = -1 (nenhuma), 0 (1ª), 1 (2ª), 2 (3ª)
      const proximaAdv = advAtual + 1; // índice do próximo cargo

      if (proximaAdv >= CARGOS_ADV.length) {
        return interaction.reply({ content: `⚠️ ${membro} JÁ POSSUI A **3ª ADVERTÊNCIA** (MÁXIMO ATINGIDO).`, flags: 64 });
      }

      // Remover cargo de advertência anterior se houver
      if (advAtual >= 0) {
        await membro.roles.remove(CARGOS_ADV[advAtual]).catch(() => {});
      }
      // Adicionar novo cargo de advertência
      await membro.roles.add(CARGOS_ADV[proximaAdv]);

      // Cruzamento com o jogo (2026-09-21): se esse sócio já está com
      // restrição ativa (blacklist/suspensão/impedimento), avisa a liderança
      // em 🚨・associado-em-atenção. Sem await: alerta é bônus, não pode
      // atrasar a resposta de quem está registrando a advertência.
      verificarRestricaoAoAdvertir(interaction.client, membro);

      const numAdv = proximaAdv + 1;
      const expiraEm = Math.floor(Date.now() / 1000) + prazoNum * 86400;

      const embed = {
        color: tema.cor.perigo,
        title: `❌ ADVERTÊNCIA ${numAdv}ª REGISTRADA`,
        fields: [
          { name: 'MEMBRO', value: `<@${membro.id}>`, inline: true },
          { name: 'ADVERTÊNCIA', value: `${numAdv}ª`, inline: true },
          { name: 'MOTIVO', value: motivo, inline: false },
          { name: 'PUNIÇÃO', value: punicao, inline: false },
          { name: 'PRAZO DE PAGAMENTO', value: `${prazoLabel} — <t:${expiraEm}:F>`, inline: false },
          { name: 'PROVA', value: prova || 'NÃO INFORMADA', inline: false },
          { name: 'REGISTRADO POR', value: `<@${interaction.user.id}>`, inline: false },
          { name: 'DATA', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
        ],
        footer: { text: '⚠️ O NÃO PAGAMENTO DENTRO DO PRAZO RESULTARÁ NA PERDA AUTOMÁTICA DO CARGO DE SÓCIO.' }
      };

      const canalHistoricoAdv = interaction.guild.channels.cache.get(CANAL_HISTORICO);
      if (canalHistoricoAdv) await canalHistoricoAdv.send({ embeds: [embed] });

      await interaction.reply({ content: `🦅 **${numAdv}ª ADVERTÊNCIA** REGISTRADA PARA ${membro}. PRAZO: **${prazoLabel}** (<t:${expiraEm}:F>).
> ⚠️ O NÃO PAGAMENTO DENTRO DO PRAZO RESULTARÁ NA PERDA DOS CARGOS NO SERVIDOR.`, flags: 64 });

      // Vencimento pelo agendador persistente: sobrevive a reinício do bot
      try {
        await agendar('adv_vencimento', new Date(Date.now() + prazoMs), {
          variante: 'socio', membroId, cargoAdv: CARGOS_ADV[proximaAdv], numAdv, motivo, punicao, prazoLabel, expiraEm,
        });
      } catch (err) {
        console.error('[adv] Erro ao agendar vencimento:', err);
        await interaction.followUp({ content: '⚠️ A ADVERTÊNCIA FOI REGISTRADA, MAS O VENCIMENTO AUTOMÁTICO NÃO FOI AGENDADO. ACOMPANHE O PRAZO MANUALMENTE.', flags: 64 }).catch(() => {});
      }

      return;
});

// modal_remover_advertencia:…
registrarModulo('modal_remover_advertencia', async interaction => {
  const membroId = interaction.customId.split(':')[1];
  const motivo   = interaction.fields.getTextInputValue('motivo');
  const prova    = interaction.fields.getTextInputValue('prova') || null;

  let membro;
  try {
    membro = await interaction.guild.members.fetch(membroId);
  } catch {
    return interaction.reply({ content: `❌ MEMBRO NÃO ENCONTRADO NO SERVIDOR.`, flags: 64 });
  }

  const CANAL_HISTORICO = config.canais.historicoAdv;
  const CARGOS_ADV = config.cargos.adv; // ADV¹/²/³ de sócio

  // Encontrar cargo de advertência atual
  const advAtual = CARGOS_ADV.findIndex(id => membro.roles.cache.has(id));

  if (advAtual === -1) {
    return interaction.reply({ content: `⚠️ ${membro} NÃO POSSUI NENHUMA ADVERTÊNCIA REGISTRADA.`, flags: 64 });
  }

  // Remover cargo atual
  await membro.roles.remove(CARGOS_ADV[advAtual]);

  // Dar cargo anterior se existir
  if (advAtual > 0) {
    await membro.roles.add(CARGOS_ADV[advAtual - 1]);
  }

  const numAdv = advAtual + 1;
  const embed = {
    color: tema.cor.primaria,
    title: `🦅 ADVERTÊNCIA ${numAdv}ª REMOVIDA`,
    fields: [
      { name: 'MEMBRO', value: `<@${membro.id}>`, inline: true },
      { name: 'ADVERTÊNCIA REMOVIDA', value: `${numAdv}ª`, inline: true },
      { name: 'MOTIVO', value: motivo, inline: false },
      { name: 'PROVA', value: prova || 'NÃO INFORMADA', inline: false },
      { name: 'REMOVIDO POR', value: `<@${interaction.user.id}>`, inline: false },
      { name: 'DATA', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
    ]
  };

  const canalHistoricoAdv = interaction.guild.channels.cache.get(CANAL_HISTORICO);
  if (canalHistoricoAdv) await canalHistoricoAdv.send({ embeds: [embed] });

  await interaction.reply({ content: `🦅 **${numAdv}ª ADVERTÊNCIA** REMOVIDA DE ${membro}.`, flags: 64 });
  return;
});
