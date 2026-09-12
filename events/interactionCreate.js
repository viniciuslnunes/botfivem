// Handler de eventos: interactionCreate
// (Aqui você pode migrar toda a lógica de recrutamento, aprovação, etc)

const { botoesRecrutamento } = require('../utils/recrutamentoButtons');
const config = require('../config/index.js');
const db = require('../utils/db');
const { gerarCarteirinha } = require('../utils/gerarCarteirinha');
const { atualizarMural } = require('../utils/muralAssociados');
const { criarCanalTicket, gerarTranscript, CANAL_LOGS, LOGO_PATH, CATEGORIAS } = require('../utils/ticket');
const { atualizarTopRecrutadores } = require('../utils/topRecrutadores');
const { agendar } = require('../utils/agendador');
require('../utils/tarefas'); // registra os tipos de tarefa (vencimento de ADV, remoção de cargo)
const { buscarBloqueio, mensagensDoBloqueio, invalidarCacheBloqueios } = require('../utils/naoRecrutar');
const { despacharInteracao } = require('../utils/modulos');
const { decisaoEmAndamento, travarFicha, liberarFicha } = require('../utils/recrutamento/trava');
const { abrirRecrutamento, abrirLaudoReprovacao } = require('../utils/recrutamento/fluxo');
const { registrarFicha, decidirFicha } = require('../utils/recrutamento/fichas');
const { situacaoCarteirinha, textoSituacao } = require('../utils/carteirinha/regras');
const { registrarSinal } = require('../utils/confianca/servico');
const { mapearSociosPorIdFivem } = require('../utils/recrutamento/funil');
const { garantirMembrosCarregados } = require('../utils/membrosGuild');

// Advertência de recrutador tem cargos próprios; reusar os de sócio escalaria as duas juntas.
const advRecConfigurada = () =>
  Array.isArray(config.cargos.advRec) && config.cargos.advRec.length === 3 && config.cargos.advRec.every(Boolean);
const MSG_ADV_REC_SEM_CARGOS = '⚠️ CARGOS DE ADVERTÊNCIA DE RECRUTADOR NÃO CONFIGURADOS. PEÇA A UM ADMINISTRADOR PARA PREENCHER `cargos.advRec` NA CONFIGURAÇÃO DO BOT.';

module.exports = (client, _config, utils) => {
  client.on('interactionCreate', async interaction => {
    try {
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) {
        await command.autocomplete(interaction).catch(err => console.error('[autocomplete] Erro:', err));
      }
      return;
    }

    // Módulos novos (customId "<modulo>:...") resolvem aqui
    if (await despacharInteracao(interaction)) return;

    // Handler para botão de abrir ticket → mostra select de categoria
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

      // Verificar se usuário já tem ticket aberto
      const jaAberto = interaction.guild.channels.cache.find(
        c => c.name === `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`
      );
      if (jaAberto) {
        return interaction.reply({ content: `VOCÊ JÁ TEM UM TICKET ABERTO: ${jaAberto}`, flags: 64 });
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId('select_categoria_ticket')
        .setPlaceholder('SELECIONE A CATEGORIA DO SEU TICKET')
        .addOptions([
          { label: '🤝 PARCERIA',            value: 'parceria',         description: 'Propostas de parceria com a torcida' },
          { label: '🚨 DENÚNCIA',            value: 'denuncia',          description: 'Denúncias gerais' },
          { label: '🔒 DENUNCIAR DIRETOR',   value: 'denuncia_diretor',  description: 'Privado — diretores não visualizam' },
          { label: '📋 RECRUTAMENTO',        value: 'recrutamento',      description: 'Dúvidas sobre recrutamento' },
        ]);

      const row = new ActionRowBuilder().addComponents(select);
      await interaction.reply({ content: '**🎫 ABRIR TICKET** — SELECIONE A CATEGORIA:', components: [row], flags: 64 });
      return;
    }

    // Handler para select de categoria → cria canal do ticket
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_categoria_ticket') {
      const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
      const categoria = interaction.values[0];
      const info = CATEGORIAS[categoria];

      await interaction.deferUpdate();

      const canal = await criarCanalTicket(interaction.guild, interaction.user, categoria);

      const avisoPrivado = categoria === 'denuncia_diretor'
        ? '\n> 🔒 ESTE TICKET É **PRIVADO** — MEMBROS COM CARGO DIRETOR NÃO TÊM ACESSO.'
        : '';

      const embed = new EmbedBuilder()
        .setColor(info.cor)
        .setTitle(`${info.emoji} TICKET CRIADO — ${info.label}`)
        .setDescription(`OLÁ ${interaction.user}, ESTE É O SEU TICKET. NOSSA EQUIPE DA GAVIÕES DA FIEL VAI TE ATENDER EM BREVE. POR FAVOR, DESCREVA SEU PROBLEMA OU DÚVIDA.${avisoPrivado}`)
        .setThumbnail('attachment://gavioesdafielfivem_logo.png')
        .setFooter({ text: new Date().toLocaleString('pt-BR') });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('fechar_ticket')
          .setLabel('FECHAR TICKET')
          .setStyle(ButtonStyle.Danger)
      );

      await canal.send({
        content: `${interaction.user}`,
        embeds: [embed],
        components: [row],
        files: [{ attachment: LOGO_PATH, name: 'gavioesdafielfivem_logo.png' }]
      });

      await interaction.editReply({ content: `🦅 TICKET CRIADO: ${canal}`, components: [] });
      return;
    }

    // Handler para botão de fechar ticket
    if (interaction.isButton() && interaction.customId === 'fechar_ticket') {
      const canal = interaction.channel;
      if (!canal.name.startsWith('ticket-')) return;

      await interaction.deferReply({ flags: 64 });
      await interaction.editReply({ content: '⏳ GERANDO TRANSCRIPT E FECHANDO TICKET...' });

      try {
        const html = await gerarTranscript(canal);
        const buffer = Buffer.from(html, 'utf-8');

        const canalLogs = await interaction.client.channels.fetch(CANAL_LOGS);
        if (canalLogs) {
          await canalLogs.send({
            content: `🦅 TICKET FECHADO: **${canal.name}** — FECHADO POR ${interaction.user}`,
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

      if (!interaction.member.roles.cache.has(config.cargos.socio)) {
        return interaction.editReply({ content: '❌ A CARTEIRINHA É EXCLUSIVA PARA SÓCIOS APROVADOS.' });
      }

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
        return interaction.editReply({ content: '❌ ERRO AO GERAR A CARTEIRINHA. TENTE NOVAMENTE.' });
      }

      const situacao = situacaoCarteirinha(row.validade, new Date(), config.carteirinha.vencendoDias);
      await interaction.editReply({
        content: `🏆 SUA CARTEIRINHA DE SÓCIO Nº **${String(row.numero_socio).padStart(4, '0')}**!\n${textoSituacao(situacao)}${situacao.situacao === 'VENCIDA' ? ' — PROCURE A DIRETORIA PARA RENOVAR.' : ''}`,
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
    }
    // Handler para botão de abrir modal de remoção de ID bloqueado
    if (interaction.isButton() && interaction.customId === 'abrir_desbloquearid') {
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
    }
    // Handler para botão de abrir modal de validação de ID
    if (interaction.isButton() && interaction.customId === 'abrir_validarid') {
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
    }

    // Handler para botão de abrir select de membro para registrar advertência
    if (interaction.isButton() && interaction.customId === 'abrir_registrar_advertencia') {
      const { UserSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('select_membro_adv_registrar')
          .setPlaceholder('SELECIONE O MEMBRO PARA ADVERTIR')
      );
      await interaction.reply({ content: '**⛔ REGISTRAR ADVERTÊNCIA** — SELECIONE O MEMBRO:', components: [row], flags: 64 });
      return;
    }

    // Handler para botão de abrir select de membro para remover advertência
    if (interaction.isButton() && interaction.customId === 'abrir_remover_advertencia') {
      const { UserSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('select_membro_adv_remover')
          .setPlaceholder('SELECIONE O MEMBRO PARA REMOVER ADVERTÊNCIA')
      );
      await interaction.reply({ content: '**🦅 REMOVER ADVERTÊNCIA** — SELECIONE O MEMBRO:', components: [row], flags: 64 });
      return;
    }

    // Handler para select de membro → mostra select de prazo (registrar)
    if (interaction.isUserSelectMenu() && interaction.customId === 'select_membro_adv_registrar') {
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
    }

    // Handler para select de prazo → abre modal (registrar)
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_prazo_adv:')) {
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
    }

    // Handler para select de membro → abre modal (remover)
    if (interaction.isUserSelectMenu() && interaction.customId === 'select_membro_adv_remover') {
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
    }

    // Handler para submissão do modal de validação de ID
    if (interaction.isModalSubmit() && interaction.customId === 'modal_validarid') {
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
    }
// Handler para submissão do modal de bloqueio de ID
    if (interaction.isModalSubmit() && interaction.customId === 'modal_bloquearid') {
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
        color: 0xFF0000,
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
    }

    // Handler para submissão do modal de remoção de ID bloqueado
    if (interaction.isModalSubmit() && interaction.customId === 'modal_desbloquearid') {
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
          color: 0x808080,
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
    }

    // Handler para submissão do modal de registrar advertência
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_registrar_advertencia:')) {
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

      const numAdv = proximaAdv + 1;
      const expiraEm = Math.floor(Date.now() / 1000) + prazoNum * 86400;

      const embed = {
        color: 0xFF0000,
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
        color: 0x000000,
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
    }

    // ── ADVERTÊNCIAS DE RECRUTADORES ────────────────────────────────────────

    // Handler para botão de abrir select de membro para registrar advertência de recrutador
    if (interaction.isButton() && interaction.customId === 'abrir_registrar_adv_rec') {
      if (!advRecConfigurada()) return interaction.reply({ content: MSG_ADV_REC_SEM_CARGOS, flags: 64 });
      const { UserSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('select_membro_adv_rec_registrar')
          .setPlaceholder('SELECIONE O RECRUTADOR PARA ADVERTIR')
      );
      await interaction.reply({ content: '**⛔ REGISTRAR ADVERTÊNCIA DE RECRUTADOR** — SELECIONE O MEMBRO:', components: [row], flags: 64 });
      return;
    }

    // Handler para botão de abrir select de membro para remover advertência de recrutador
    if (interaction.isButton() && interaction.customId === 'abrir_remover_adv_rec') {
      if (!advRecConfigurada()) return interaction.reply({ content: MSG_ADV_REC_SEM_CARGOS, flags: 64 });
      const { UserSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('select_membro_adv_rec_remover')
          .setPlaceholder('SELECIONE O RECRUTADOR PARA REMOVER ADVERTÊNCIA')
      );
      await interaction.reply({ content: '**🦅 REMOVER ADVERTÊNCIA DE RECRUTADOR** — SELECIONE O MEMBRO:', components: [row], flags: 64 });
      return;
    }

    // Handler para select de membro → mostra select de prazo (registrar recrutador)
    if (interaction.isUserSelectMenu() && interaction.customId === 'select_membro_adv_rec_registrar') {
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
    }

    // Handler para select de prazo → abre modal (registrar recrutador)
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_prazo_adv_rec:')) {
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
    }

    // Handler para select de membro → abre modal (remover recrutador)
    if (interaction.isUserSelectMenu() && interaction.customId === 'select_membro_adv_rec_remover') {
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
    }

    // Handler para submissão do modal de registrar advertência de recrutador
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_registrar_adv_rec:')) {
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
        color: 0xFF0000,
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
    }

    // Handler para submissão do modal de remover advertência de recrutador
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_remover_adv_rec:')) {
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
        color: 0x000000,
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
    }

    // ── FIM ADVERTÊNCIAS DE RECRUTADORES ─────────────────────────────────────

    // Comando slash
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction);
      } catch (err) {
        if (err.code === 10062 || err.code === 40060) return;
        console.error(err);
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: 'ERRO AO EXECUTAR COMANDO.', flags: 64 }).catch(() => {});
        } else {
          await interaction.reply({ content: 'ERRO AO EXECUTAR COMANDO.', flags: 64 }).catch(() => {});
        }
      }
      return;
    }

    // Handler para submissão do modal
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_recrutamento')) {
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
            description: '⚠️ **ERRO:** O CAMPO **ID FIVEM** DEVE CONTER APENAS NÚMEROS.\n\nPOR FAVOR, REFAÇA O FORMULÁRIO DE RECRUTAMENTO PREENCHENDO CORRETAMENTE.'
          }],
          flags: 64
        });
      }
      // Validação: Idade deve conter apenas números e até 2 dígitos
      if (!/^[0-9]{1,2}$/.test(idade)) {
        return interaction.reply({
          embeds: [{
            color: 0x000000,
            description: '⚠️ **ERRO:** O CAMPO **IDADE** DEVE CONTER APENAS NÚMEROS E TER NO MÁXIMO 2 DÍGITOS.\n\nPOR FAVOR, REFAÇA O FORMULÁRIO DE RECRUTAMENTO PREENCHENDO CORRETAMENTE.'
          }],
          flags: 64
        });
      }
      // Validação: Telefone deve conter apenas números, com 10 ou 11 dígitos
      if (!/^\d{10,11}$/.test(telefone)) {
        return interaction.reply({
          embeds: [{
            color: 0x000000,
            description: '⚠️ **ERRO:** O CAMPO **TELEFONE** DEVE CONTER APENAS NÚMEROS, COM 10 OU 11 DÍGITOS.\nEXEMPLO: 11912345678\n\nPOR FAVOR, REFAÇA O FORMULÁRIO DE RECRUTAMENTO PREENCHENDO CORRETAMENTE.'
          }],
          flags: 64
        });
      }
      const canalRecrutamento = interaction.guild.channels.cache.get(config.canais.recrutamento);
      if (!canalRecrutamento) return interaction.reply({ content: 'CANAL DE RECRUTAMENTO NÃO ENCONTRADO.', flags: 64 });
      const embed = {
        color: 0x000000,
        title: '📋 NOVA SOLICITAÇÃO DE RECRUTAMENTO',
        fields: [
          { name: 'NOME', value: nome, inline: false },
          { name: 'IDADE', value: idade, inline: false },
          { name: 'ID FIVEM', value: id_fivem, inline: false },
          { name: 'TELEFONE', value: telefone, inline: false },
          { name: 'RECRUTADOR', value: recrutador, inline: false },
          { name: 'ID | DISCORD', value: `${user.id} | <@${user.id}>`, inline: false }
        ]
      };
      await interaction.reply({ content: 'SUA SOLICITAÇÃO FOI ENVIADA PARA ANÁLISE! AGUARDE AS PRÓXIMAS INSTRUÇÕES.', flags: 64 });
      // Enviar embed com botões para aprovar/recusar no canal validar-setagem
      const canalValidarSetagem = interaction.guild.channels.cache.get(config.canais.validarSetagem);
      if (canalValidarSetagem) {
        const mensagemFicha = await canalValidarSetagem.send({ embeds: [embed], components: botoesRecrutamento() });
        await registrarFicha({
          messageId: mensagemFicha.id, discordId: user.id, nome, idade, idFivem: id_fivem, telefone, recrutador,
        }).catch(err => console.error('[recrutamento] Erro ao registrar ficha:', err));
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
        // Remoção do cargo em 10 minutos pelo agendador persistente (sobrevive a reinício)
        await agendar('remover_cargo', new Date(Date.now() + 10 * 60 * 1000), {
          membroId: user.id, cargoId: config.cargos.provarManto,
        }).catch(err => console.error('Erro ao agendar remoção do cargo PROVAR MANTO:', err));
      } catch (err) {
        console.error('Erro ao atribuir cargo PROVAR MANTO:', err);
      }
    }

    // Handler para botão de abrir recrutamento: confere a situação do candidato e abre o formulário
    if (interaction.isButton() && interaction.customId === 'abrir_recrutamento') {
      await abrirRecrutamento(interaction);
      return;
    }
    // Reprovar abre o laudo (categoria, reenvio e justificativa); a decisão acontece no envio do modal
    if (interaction.isButton() && interaction.customId === 'reprovar_recrutamento') {
      await abrirLaudoReprovacao(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId === 'aprovar_recrutamento') {
      // Trava contra clique duplo: dois recrutadores decidindo a mesma ficha ao mesmo tempo
      const fichaId = interaction.message.id;
      if (decisaoEmAndamento(fichaId) || interaction.message.components.length === 0) {
        return interaction.reply({ content: '⚠️ ESTA SOLICITAÇÃO JÁ ESTÁ SENDO (OU JÁ FOI) ANALISADA POR OUTRO RECRUTADOR.', flags: 64 });
      }
      travarFicha(fichaId);
      try {
      {
        // Extrair dados do candidato do embed ANTES da busca no histórico
        const embed = interaction.message.embeds[0];
        const idField = embed.fields.find(f => f.name.startsWith('ID | DISCORD'));
        const candidatoId = idField ? idField.value.split(' ')[0] : null;
        const nomeField = embed.fields.find(f => f.name === 'NOME');
        const idFiveMField = embed.fields.find(f => f.name === 'ID FIVEM');
        const nome = nomeField ? nomeField.value : '';
        const id_fivem = idFiveMField ? idFiveMField.value : '';
        // O histórico inteiro da lista é lido (pode levar alguns segundos): deferir antes
        await interaction.deferUpdate();
        let bloqueado;
        try {
          bloqueado = await buscarBloqueio(client, id_fivem);
        } catch (err) {
          console.error('Erro ao buscar histórico de não recrutar:', err);
          await interaction.followUp({ content: '❌ NÃO FOI POSSÍVEL CONSULTAR A LISTA DE NÃO RECRUTAR. NADA FOI APROVADO — TENTE NOVAMENTE.', flags: 64 });
          return;
        }
        if (bloqueado) {
          await interaction.channel.send({
            content: `❌ O ID FiveM **${id_fivem}** está bloqueado para recrutamento!`,
            embeds: [bloqueado]
          });
          return;
        }
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
          atualizarTopRecrutadores(client).catch(err => console.error('[aprovar] Erro ao atualizar top recrutadores:', err));
          await decidirFicha(fichaId, { status: 'APROVADO', decididoPorId: interaction.user.id }, embed)
            .catch(err => console.error('[aprovar] Erro ao registrar decisão da ficha:', err));
          await registrarSinal(client, { discordId: candidatoId, sinal: 'APROVACAO', origemTipo: 'ficha', origemId: fichaId })
            .catch(err => console.error('[aprovar] Erro ao registrar sinal de confiança:', err));
        } catch (err) {
          console.error('Erro ao registrar aprovação no banco:', err);
          await interaction.channel.send({
            content: `⚠️ NÃO FOI POSSÍVEL ATRIBUIR/REMOVER CARGOS OU REGISTRAR APROVAÇÃO DE <@${candidatoId}>. VERIFIQUE SE O USUÁRIO ESTÁ NO SERVIDOR E SE O BOT TEM PERMISSÃO.\n\nERRO TÉCNICO: ${err.message}`
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
              name: 'STATUS',
              value: `🦅 APROVADO POR <@${interaction.user.id}>`,
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
            const canalValidarSetagem = interaction.guild.channels.cache.get(config.canais.validarSetagem);
            if (canalValidarSetagem) {
              await canalValidarSetagem.send({
                content: `🦅 <@${candidatoId}> finalizou o tempo de PROVAR MANTO. Pronto para validação de setagem!`
              });
            } else {
              console.error('Canal de validação de setagem não encontrado!');
            }
          })
          .catch(() => {
            // Mensagens removidas conforme solicitado: não avisar timeout nem canal privado
          });
      }
      } finally {
        liberarFicha(fichaId);
      }
    }

    } catch (err) {
      // Ignora interações expiradas (10062) ou já respondidas (40060)
      if (err.code === 10062 || err.code === 40060) return;
      console.error('[interactionCreate] Erro não tratado:', err);
    }
  });
};
