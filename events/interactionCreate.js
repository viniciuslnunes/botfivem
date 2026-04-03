// Handler de eventos: interactionCreate
// (Aqui você pode migrar toda a lógica de recrutamento, aprovação, etc)

const recrutamentoButtons = require('../utils/recrutamentoButtons');
const config = require('../config/index.js');
const db = require('../utils/db');
const { gerarCarteirinha } = require('../utils/gerarCarteirinha');
const { atualizarMural } = require('../utils/muralAssociados');
const { criarCanalTicket, gerarTranscript, CANAL_LOGS, LOGO_PATH } = require('../utils/ticket');

module.exports = (client, _config, utils) => {
  client.on('interactionCreate', async interaction => {
    // Handler para botão de abrir ticket
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

      // Verificar se usuário já tem ticket aberto
      const jaAberto = interaction.guild.channels.cache.find(
        c => c.name === `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`
      );
      if (jaAberto) {
        return interaction.reply({ content: `Você já tem um ticket aberto: ${jaAberto}`, flags: 64 });
      }

      await interaction.deferReply({ flags: 64 });

      const canal = await criarCanalTicket(interaction.guild, interaction.user);

      const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('🎫 Ticket Criado')
        .setDescription(`Olá ${interaction.user}, este é o seu ticket. Nossa equipe da Gaviões da Fiel vai te atender em breve. Por favor, descreva seu problema ou dúvida.`)
        .setThumbnail('attachment://gavioesdafielfivem_logo.png')
        .setFooter({ text: new Date().toLocaleString('pt-BR') });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('fechar_ticket')
          .setLabel('Fechar Ticket')
          .setStyle(ButtonStyle.Danger)
      );

      await canal.send({
        content: `${interaction.user}`,
        embeds: [embed],
        components: [row],
        files: [{ attachment: LOGO_PATH, name: 'gavioesdafielfivem_logo.png' }]
      });

      await interaction.editReply({ content: `✅ Ticket criado: ${canal}` });
      return;
    }

    // Handler para botão de fechar ticket
    if (interaction.isButton() && interaction.customId === 'fechar_ticket') {
      const canal = interaction.channel;
      if (!canal.name.startsWith('ticket-')) return;

      await interaction.deferReply({ flags: 64 });
      await interaction.editReply({ content: '⏳ Gerando transcript e fechando ticket...' });

      try {
        const html = await gerarTranscript(canal);
        const buffer = Buffer.from(html, 'utf-8');

        const canalLogs = await interaction.client.channels.fetch(CANAL_LOGS);
        if (canalLogs) {
          await canalLogs.send({
            content: `✅ Ticket fechado: **${canal.name}** — fechado por ${interaction.user}`,
            files: [{ attachment: buffer, name: `transcript-${canal.id}.html` }]
          });
        }
      } catch (err) {
        console.error('[ticket] Erro ao gerar transcript:', err);
      }

      await canal.delete().catch(() => {});
      return;
    }

    // Handler para botão de solicitar carteirinha
    if (interaction.isButton() && interaction.customId === 'solicitar_carteirinha') {
      await interaction.deferReply({ flags: 64 });

      const discordId = interaction.user.id;
      const membro = interaction.member;
      const nome = membro.nickname || interaction.user.displayName || interaction.user.username;

      let row;
      let isNovo = false;
      const existing = await db.query('SELECT * FROM socios WHERE discord_id = $1', [discordId]);

      if (existing.rows.length > 0) {
        row = existing.rows[0];
      } else {
        const maxResult = await db.query('SELECT COALESCE(MAX(numero_socio), 0) AS max FROM socios');
        const proximoNumero = maxResult.rows[0].max + 1;
        const validade = new Date();
        validade.setFullYear(validade.getFullYear() + 1);
        const insert = await db.query(
          'INSERT INTO socios (discord_id, numero_socio, nome, validade) VALUES ($1, $2, $3, $4) RETURNING *',
          [discordId, proximoNumero, nome, validade.toISOString().split('T')[0]]
        );
        row = insert.rows[0];
        isNovo = true;
      }

      const dataValidade = new Date(row.validade);
      const validadeFormatada = dataValidade.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
      const avatarUrl = interaction.user.displayAvatarURL({ extension: 'png', size: 256 });

      let buffer;
      try {
        buffer = await gerarCarteirinha({ nome, numeroSocio: row.numero_socio, validade: validadeFormatada, avatarUrl });
      } catch (err) {
        console.error('[solicitar_carteirinha] Erro ao gerar imagem:', err);
        return interaction.editReply({ content: '❌ Erro ao gerar a carteirinha. Tente novamente.' });
      }

      await interaction.editReply({
        content: `🏆 Sua carteirinha de sócio nº **${String(row.numero_socio).padStart(4, '0')}**!`,
        files: [{ attachment: buffer, name: 'carteirinha.png' }]
      });

      if (isNovo) {
        atualizarMural(client).catch(err => console.error('[solicitar_carteirinha] Erro ao atualizar mural:', err));
      }
      return;
    }

    // Handler para botão de abrir modal de bloqueio de ID
    if (interaction.isButton() && interaction.customId === 'abrir_bloquearid') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
      const modal = new ModalBuilder()
        .setCustomId('modal_bloquearid')
        .setTitle('Bloquear novo ID - Não Recrutar');
      const idInput = new TextInputBuilder()
        .setCustomId('id')
        .setLabel('ID FiveM para bloquear')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(8);
      const motivoInput = new TextInputBuilder()
        .setCustomId('motivo')
        .setLabel('Motivo do bloqueio')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(100);
      const provaInput = new TextInputBuilder()
        .setCustomId('prova')
        .setLabel('Prova (opcional, link ou info)')
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
    }
    // Handler para botão de abrir modal de validação de ID
    if (interaction.isButton() && interaction.customId === 'abrir_validarid') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
      const modal = new ModalBuilder()
        .setCustomId('modal_validarid')
        .setTitle('Validar ID - Não Recrutar');
      const idInput = new TextInputBuilder()
        .setCustomId('id_fivem')
        .setLabel('ID FiveM para validar')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(8);
      modal.addComponents(new ActionRowBuilder().addComponents(idInput));
      await interaction.showModal(modal);
      return;
    }

    // Handler para botão de abrir select de membro para registrar advertência
    if (interaction.isButton() && interaction.customId === 'abrir_registrar_advertencia') {
      const { UserSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('select_membro_adv_registrar')
          .setPlaceholder('Selecione o membro para advertir')
      );
      await interaction.reply({ content: '**⛔ Registrar Advertência** — Selecione o membro:', components: [row], flags: 64 });
      return;
    }

    // Handler para botão de abrir select de membro para remover advertência
    if (interaction.isButton() && interaction.customId === 'abrir_remover_advertencia') {
      const { UserSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('select_membro_adv_remover')
          .setPlaceholder('Selecione o membro para remover advertência')
      );
      await interaction.reply({ content: '**✅ Remover Advertência** — Selecione o membro:', components: [row], flags: 64 });
      return;
    }

    // Handler para select de membro → abre modal (registrar)
    if (interaction.isUserSelectMenu() && interaction.customId === 'select_membro_adv_registrar') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
      const membroId = interaction.values[0];
      const modal = new ModalBuilder()
        .setCustomId(`modal_registrar_advertencia:${membroId}`)
        .setTitle('Registrar Advertência');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('motivo').setLabel('Motivo da advertência').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(300)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('prova').setLabel('Prova (opcional, link ou descrição)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200)
        )
      );
      await interaction.showModal(modal);
      return;
    }

    // Handler para select de membro → abre modal (remover)
    if (interaction.isUserSelectMenu() && interaction.customId === 'select_membro_adv_remover') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
      const membroId = interaction.values[0];
      const modal = new ModalBuilder()
        .setCustomId(`modal_remover_advertencia:${membroId}`)
        .setTitle('Remover Advertência');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('motivo').setLabel('Motivo da remoção').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(300)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('prova').setLabel('Prova (opcional, link ou descrição)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200)
        )
      );
      await interaction.showModal(modal);
      return;
    }

    // Handler para submissão do modal de validação de ID
    if (interaction.isModalSubmit() && interaction.customId === 'modal_validarid') {
      const id_fivem = interaction.fields.getTextInputValue('id_fivem');
      // Buscar IDs bloqueados no canal de histórico-nao-recrutar
      const canalHistorico = interaction.guild.channels.cache.get('1487943943680163890');
      let bloqueado = null;
      if (canalHistorico && canalHistorico.isTextBased()) {
        try {
          const msgs = await canalHistorico.messages.fetch({ limit: 100 });
          msgs.forEach(msg => {
            if (msg.embeds && msg.embeds.length > 0) {
              const embed = msg.embeds[0];
              const idField = embed.fields?.find(f => f.name === 'ID');
              if (idField && idField.value === id_fivem) {
                bloqueado = embed;
              }
            }
          });
        } catch (err) {
          console.error('Erro ao buscar histórico de não recrutar:', err);
        }
      }
      if (bloqueado) {
        await interaction.reply({
          content: `❌ O ID FiveM **${id_fivem}** está bloqueado para recrutamento!`,
          embeds: [bloqueado],
          flags: 64
        });
      } else {
        await interaction.reply({
          content: `✅ O ID FiveM **${id_fivem}** está **liberado** para recrutamento!`,
          flags: 64
        });
      }
      return;
    }
// Handler para submissão do modal de bloqueio de ID
    if (interaction.isModalSubmit() && interaction.customId === 'modal_bloquearid') {
      const id = interaction.fields.getTextInputValue('id');
      const motivo = interaction.fields.getTextInputValue('motivo');
      const prova = interaction.fields.getTextInputValue('prova');
      const canalHistorico = interaction.guild.channels.cache.get('1487943943680163890');
      if (!canalHistorico || !canalHistorico.isTextBased()) {
        return interaction.reply({ content: 'Canal de histórico não encontrado.', flags: 64 });
      }
      const embed = {
        color: 0x000000,
        title: 'ID Bloqueado para Recrutamento',
        fields: [
          { name: 'ID', value: id, inline: false },
          { name: 'Motivo', value: motivo, inline: false },
          { name: 'Prova', value: prova || 'Não informado', inline: false },
          { name: 'Autor', value: `<@${interaction.user.id}>`, inline: false },
          { name: 'Data', value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: false }
        ]
      };
      await canalHistorico.send({ embeds: [embed] });
      await interaction.reply({ content: `ID ${id} bloqueado com sucesso!`, flags: 64 });
      return;
    }

    // Handler para submissão do modal de registrar advertência
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_registrar_advertencia:')) {
      const membroId = interaction.customId.split(':')[1];
      const motivo   = interaction.fields.getTextInputValue('motivo');
      const prova    = interaction.fields.getTextInputValue('prova') || null;

      let membro;
      try {
        membro = await interaction.guild.members.fetch(membroId);
      } catch {
        return interaction.reply({ content: `❌ Membro não encontrado no servidor.`, flags: 64 });
      }

      const CANAL_HISTORICO = '1488654031709671574';
      const CARGOS_ADV = [
        '1341153479602864188', // ADV¹
        '1341149153992114229', // ADV²
        '1340321522547429458', // ADV³
      ];

      // Verificar quantas advertências o membro já tem
      const advAtual = CARGOS_ADV.findIndex(id => membro.roles.cache.has(id));
      // advAtual = -1 (nenhuma), 0 (1ª), 1 (2ª), 2 (3ª)
      const proximaAdv = advAtual + 1; // índice do próximo cargo

      if (proximaAdv >= CARGOS_ADV.length) {
        return interaction.reply({ content: `⚠️ ${membro} já possui a **3ª advertência** (máximo atingido).`, flags: 64 });
      }

      // Remover cargo de advertência anterior se houver
      if (advAtual >= 0) {
        await membro.roles.remove(CARGOS_ADV[advAtual]).catch(() => {});
      }
      // Adicionar novo cargo de advertência
      await membro.roles.add(CARGOS_ADV[proximaAdv]);

      const numAdv = proximaAdv + 1;
      const embed = {
        color: 0x000000,
        title: `⛔ Advertência ${numAdv}ª registrada`,
        fields: [
          { name: 'Membro', value: `<@${membro.id}>`, inline: true },
          { name: 'Advertência', value: `${numAdv}ª`, inline: true },
          { name: 'Motivo', value: motivo, inline: false },
          { name: 'Prova', value: prova || 'Não informada', inline: false },
          { name: 'Registrado por', value: `<@${interaction.user.id}>`, inline: false },
          { name: 'Data', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
        ]
      };

      const canalHistoricoAdv = interaction.guild.channels.cache.get(CANAL_HISTORICO);
      if (canalHistoricoAdv) await canalHistoricoAdv.send({ embeds: [embed] });

      await interaction.reply({ content: `✅ **${numAdv}ª advertência** registrada para ${membro}.`, flags: 64 });
      return;
    }

    // Handler para submissão do modal de remover advertência
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_remover_advertencia:')) {
      const membroId = interaction.customId.split(':')[1];
      const motivo   = interaction.fields.getTextInputValue('motivo');
      const prova    = interaction.fields.getTextInputValue('prova') || null;

      let membro;
      try {
        membro = await interaction.guild.members.fetch(membroId);
      } catch {
        return interaction.reply({ content: `❌ Membro não encontrado no servidor.`, flags: 64 });
      }

      const CANAL_HISTORICO = '1488654031709671574';
      const CARGOS_ADV = [
        '1341153479602864188', // ADV¹
        '1341149153992114229', // ADV²
        '1340321522547429458', // ADV³
      ];

      // Encontrar cargo de advertência atual
      const advAtual = CARGOS_ADV.findIndex(id => membro.roles.cache.has(id));

      if (advAtual === -1) {
        return interaction.reply({ content: `⚠️ ${membro} não possui nenhuma advertência registrada.`, flags: 64 });
      }

      // Remover cargo atual
      await membro.roles.remove(CARGOS_ADV[advAtual]);

      // Dar cargo anterior se existir
      if (advAtual > 0) {
        await membro.roles.add(CARGOS_ADV[advAtual - 1]);
      }

      const numAdv = advAtual + 1;
      const embed = {
        color: 0x000000,
        title: `✅ Advertência ${numAdv}ª removida`,
        fields: [
          { name: 'Membro', value: `<@${membro.id}>`, inline: true },
          { name: 'Advertência removida', value: `${numAdv}ª`, inline: true },
          { name: 'Motivo', value: motivo, inline: false },
          { name: 'Prova', value: prova || 'Não informada', inline: false },
          { name: 'Removido por', value: `<@${interaction.user.id}>`, inline: false },
          { name: 'Data', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
        ]
      };

      const canalHistoricoAdv = interaction.guild.channels.cache.get(CANAL_HISTORICO);
      if (canalHistoricoAdv) await canalHistoricoAdv.send({ embeds: [embed] });

      await interaction.reply({ content: `✅ **${numAdv}ª advertência** removida de ${membro}.`, flags: 64 });
      return;
    }

    // Comando slash
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      // ...comando /recrutar removido, agora feito via botão fixo...
      // Outros comandos
      try {
        await command.execute(interaction);
      } catch (err) {
        console.error(err);
        await interaction.reply({ content: 'Erro ao executar comando.', flags: 64 });
      }
    }

    // Handler para submissão do modal
    if (interaction.isModalSubmit() && interaction.customId === 'modal_recrutamento') {
      const nome = interaction.fields.getTextInputValue('nome');
      const idade = interaction.fields.getTextInputValue('idade');
      const id_fivem = interaction.fields.getTextInputValue('id_fivem');
      const telefone = interaction.fields.getTextInputValue('telefone');
      const recrutador = interaction.fields.getTextInputValue('recrutador');
      const user = interaction.user;
      // Validação: ID FiveM deve conter apenas números
      if (!/^[0-9]+$/.test(id_fivem)) {
        return interaction.reply({
          embeds: [{
            color: 0x000000, // vermelho
            description: '⚠️ **Erro:** O campo **ID FiveM** deve conter apenas números.\n\nPor favor, refaça o formulário de recrutamento preenchendo corretamente.'
          }],
          flags: 64
        });
      }
      // Validação: Idade deve conter apenas números e até 2 dígitos
      if (!/^[0-9]{1,2}$/.test(idade)) {
        return interaction.reply({
          embeds: [{
            color: 0x000000,
            description: '⚠️ **Erro:** O campo **Idade** deve conter apenas números e ter no máximo 2 dígitos.\n\nPor favor, refaça o formulário de recrutamento preenchendo corretamente.'
          }],
          flags: 64
        });
      }
      // Validação: Telefone deve conter apenas números, com 10 ou 11 dígitos
      if (!/^\d{10,11}$/.test(telefone)) {
        return interaction.reply({
          embeds: [{
            color: 0x000000,
            description: '⚠️ **Erro:** O campo **Telefone** deve conter apenas números, com 10 ou 11 dígitos.\nExemplo: 11912345678\n\nPor favor, refaça o formulário de recrutamento preenchendo corretamente.'
          }],
          flags: 64
        });
      }
      const canalRecrutamento = interaction.guild.channels.cache.get(config.canais.recrutamento);
      if (!canalRecrutamento) return interaction.reply({ content: 'Canal de recrutamento não encontrado.', flags: 64 });
      const embed = {
        color: 0x000000,
        title: '📋 Nova Solicitação de Recrutamento',
        fields: [
          { name: 'Nome', value: nome, inline: false },
          { name: 'Idade', value: idade, inline: false },
          { name: 'ID FiveM', value: id_fivem, inline: false },
          { name: 'Telefone', value: telefone, inline: false },
          { name: 'Recrutador', value: recrutador, inline: false },
          { name: 'ID | Discord', value: `${user.id} | <@${user.id}>`, inline: false }
        ]
      };
      await interaction.reply({ content: 'Sua solicitação foi enviada para análise! Aguarde as próximas instruções.', flags: 64 });
      // Enviar embed com botões para aprovar/recusar no canal validar-setagem
      const canalValidarSetagem = interaction.guild.channels.cache.get('1442240838699712623');
      if (canalValidarSetagem) {
        await canalValidarSetagem.send({ embeds: [embed], components: recrutamentoButtons });
      } else {
        console.error('Canal de validação de setagem não encontrado!');
      }
      // Canal de solicitação de recrutamento removido: não enviar embed informativo
      try {
        const guildMember = await interaction.guild.members.fetch(user.id);
        console.log('DEBUG - ID do cargo PROVAR MANTO:', config.cargos.provarManto, typeof config.cargos.provarManto);
        await guildMember.roles.add(config.cargos.provarManto);
        // Avisar no canal provar-manto
        const canalProvarManto = interaction.guild.channels.cache.get(config.canais.provarManto);
        if (canalProvarManto) {
          const avisoMsg = await canalProvarManto.send({
            content: `<@${user.id}>, você tem 10 minutos para enviar o manto (imagem) aqui neste canal! Após esse prazo, o cargo será removido automaticamente.`
          });
          // Deletar a mensagem de aviso após 5 minutos
          setTimeout(() => {
            avisoMsg.delete().catch(() => {});
          }, 5 * 60 * 1000); // 5 minutos
        }
        // Agendar remoção do cargo e aviso em validar-setagem
        setTimeout(async () => {
          try {
            await guildMember.roles.remove(config.cargos.provarManto);
            // Não enviar mensagem de finalização de tempo de PROVAR MANTO
          } catch (err) {
            console.error('Erro ao remover cargo PROVAR MANTO ou avisar:', err);
          }
        }, 10 * 60 * 1000); // 10 minutos
      } catch (err) {
        console.error('Erro ao atribuir cargo PROVAR MANTO:', err);
      }
    }

    // Handler para botão de abrir recrutamento
    if (interaction.isButton() && interaction.customId === 'abrir_recrutamento') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
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
        .setMaxLength(2); // Máximo 2 dígitos

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
        .setMaxLength(11); // 10 ou 11 dígitos numéricos

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
      await interaction.showModal(modal);
      return;
    }
    if (interaction.isButton()) {
      if (interaction.customId === 'aprovar_recrutamento') {
        // Extrair dados do candidato do embed ANTES da busca no histórico
        const embed = interaction.message.embeds[0];
        const idField = embed.fields.find(f => f.name.startsWith('ID | Discord'));
        const candidatoId = idField ? idField.value.split(' ')[0] : null;
        const nomeField = embed.fields.find(f => f.name === 'Nome');
        const idFiveMField = embed.fields.find(f => f.name === 'ID FiveM');
        const nome = nomeField ? nomeField.value : '';
        const id_fivem = idFiveMField ? idFiveMField.value : '';
        // Buscar IDs bloqueados no canal de histórico-nao-recrutar
        const canalHistorico = interaction.guild.channels.cache.get('1487943943680163890');
        let bloqueado = null;
        if (canalHistorico && canalHistorico.isTextBased()) {
          try {
            const msgs = await canalHistorico.messages.fetch({ limit: 100 });
            msgs.forEach(msg => {
              if (msg.embeds && msg.embeds.length > 0) {
                const embedHist = msg.embeds[0];
                const idFieldHist = embedHist.fields?.find(f => f.name === 'ID');
                if (idFieldHist && idFieldHist.value === id_fivem) {
                  bloqueado = embedHist;
                }
              }
            });
          } catch (err) {
            console.error('Erro ao buscar histórico de não recrutar:', err);
          }
        }
        if (bloqueado) {
          await interaction.deferUpdate();
          await interaction.channel.send({
            content: `❌ O ID FiveM **${id_fivem}** está bloqueado para recrutamento!`,
            embeds: [bloqueado]
          });
          return;
        }
        // Deferir a atualização da interação imediatamente para evitar expiração
        await interaction.deferUpdate();
        // Dar cargo de sócio, alterar nick e registrar aprovação no banco
        const db = require('../utils/db');
        try {
          const guildMember = await interaction.guild.members.fetch(candidatoId);
          await guildMember.roles.add(config.cargos.socio);
          // Remover cargos de provar-manto e visitante
          if (config.cargos.provarManto) {
            await guildMember.roles.remove(config.cargos.provarManto).catch(() => {});
          }
          if (config.cargos.visitante) {
            await guildMember.roles.remove(config.cargos.visitante).catch(() => {});
          }
          // Alterar nick para o padrão (ignora se sem permissão)
          const novoNick = utils.formatarNick(nome, id_fivem);
          await guildMember.setNickname(novoNick).catch(() => {});
          // Registrar aprovação no banco
          await db.query('INSERT INTO aprovacoes_recrutamento (aprovador_id) VALUES ($1)', [interaction.user.id]);
        } catch (err) {
          console.error('Erro ao registrar aprovação no banco:', err);
          await interaction.channel.send({
            content: `⚠️ Não foi possível atribuir/remover cargos ou registrar aprovação de <@${candidatoId}>. Verifique se o usuário está no servidor e se o bot tem permissão.\n\nErro técnico: ${err.message}`
          });
          return;
        }
        // Montar embed de aprovação com borda verde e campo de status
        const embedAprovado = {
          title: embed.title || 'Recrutamento',
          description: embed.description || '',
          fields: [
            ...embed.fields,
            {
              name: 'Status',
              value: `✅ Aprovado por <@${interaction.user.id}>`,
              inline: false
            }
          ],
          color: 0x000000
        };
        // Atualizar a mensagem manualmente, pois interaction.update já foi deferido
        await interaction.message.edit({
          content: null,
          embeds: [embedAprovado],
          components: []
        });
        // Coletar próxima mensagem com imagem
        const filter = m => m.attachments.size > 0 && m.attachments.first().contentType && m.attachments.first().contentType.startsWith('image/');
        const channel = interaction.channel;
        channel.awaitMessages({ filter, max: 1, time: 120000, errors: ['time'] })
          .then(async collected => {
            const mantoMsg = collected.first();
            // Confirmação visual
            await channel.send({ content: `🧥 Manto recebido para <@${candidatoId}>! Processo concluído.`, reply: { messageReference: mantoMsg.id } });
            // Enviar validação de setagem para o canal privado após envio do manto
            const canalValidarSetagem = interaction.guild.channels.cache.get('1442240838699712623');
            if (canalValidarSetagem) {
              await canalValidarSetagem.send({
                content: `✅ <@${candidatoId}> finalizou o tempo de PROVAR MANTO. Pronto para validação de setagem!`
              });
            } else {
              console.error('Canal de validação de setagem não encontrado!');
            }
          })
          .catch(() => {
            // Mensagens removidas conforme solicitado: não avisar timeout nem canal privado
          });
      } else if (interaction.customId === 'reprovar_recrutamento') {
        // Copiar o embed original e mudar a cor para vermelho, garantindo todos os campos obrigatórios
        const embedOriginal = interaction.message.embeds[0];
        // Copiar os campos e adicionar o status de reprovação
        const fields = Array.isArray(embedOriginal.fields) ? [...embedOriginal.fields] : [];
        // Adicionar campo de status de reprovação
        fields.push({
          name: 'Status',
          value: `❌ Reprovado por <@${interaction.user.id}>`,
          inline: false
        });
        const embedReprovado = {
          title: embedOriginal.title || 'Recrutamento',
          description: embedOriginal.description || '',
          fields,
          color: 0x000000
        };
        // Remover cargos de provar-manto e visitante ao reprovar
        const idFieldReprovado = embedOriginal.fields.find(f => f.name.startsWith('ID | Discord'));
        const candidatoIdReprovado = idFieldReprovado ? idFieldReprovado.value.split(' ')[0] : null;
        if (candidatoIdReprovado) {
          try {
            const guildMember = await interaction.guild.members.fetch(candidatoIdReprovado);
            if (config.cargos.provarManto) {
              await guildMember.roles.remove(config.cargos.provarManto).catch(() => {});
            }
            if (config.cargos.visitante) {
              await guildMember.roles.remove(config.cargos.visitante).catch(() => {});
            }
            if (config.cargos.reprovadoRecrutamento) {
              await guildMember.roles.add(config.cargos.reprovadoRecrutamento).catch(() => {});
            }
          } catch {}
        }
        await interaction.update({
          content: null,
          embeds: [embedReprovado],
          components: []
        });
      }
    }

    // Handler para submissão do modal de criação de evento
    if (interaction.isModalSubmit() && interaction.customId === 'modal_evento') {
      const titulo = interaction.fields.getTextInputValue('titulo');
      const horario = interaction.fields.getTextInputValue('horario');

      const EMOJI_CONFIRMAR_ID = '1489501021108441240';
      const EMOJI_RECUSAR      = '❌';

      // Buscar emoji customizado :GAVIO:
      let emojiGavio;
      try {
        emojiGavio = await interaction.guild.emojis.fetch(EMOJI_CONFIRMAR_ID);
      } catch (e) { console.error('[evento] Emoji GAVIO não encontrado:', e.message); }

      const { EmbedBuilder } = require('discord.js');
      const emojiConfirmarStr = emojiGavio ? `<:${emojiGavio.name}:${EMOJI_CONFIRMAR_ID}>` : '✅';
      const instrucoes = `${emojiConfirmarStr} para **confirmar** presença   ❌ para **recusar**`;

      const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle(`📅 ${titulo}`)
        .setDescription(instrucoes)
        .addFields(
          { name: '🕐 Horário', value: horario, inline: false },
          { name: `${emojiConfirmarStr} Confirmados (0)`, value: '*Nenhum confirmado ainda*', inline: false }
        )
        .setFooter({ text: 'evento' });

      await interaction.reply({ content: '✅ Evento criado!', flags: 64 });
      const eventMsg = await interaction.channel.send({ embeds: [embed] });

      if (emojiGavio) {
        try { await eventMsg.react(emojiGavio); } catch (e) { console.error('[evento] Erro ao reagir confirmar:', e.message); }
      }
      try { await eventMsg.react('❌'); } catch (e) { console.error('[evento] Erro ao reagir recusar:', e.message); }
      return;
    }
  });
};
