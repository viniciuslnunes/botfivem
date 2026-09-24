// Recrutamento: formulário, aprovar e reprovar a ficha.
// Veio do antigo events/interactionCreate.js sem mudar a lógica; cada customId
// continua o mesmo, agora roteado por utils/modulos.js.
const { botoesRecrutamento } = require('../recrutamentoButtons');
const config = require('../../config/index.js');
const { atualizarTopRecrutadores } = require('../topRecrutadores');
const { agendar } = require('../agendador');
const { buscarBloqueio } = require('../naoRecrutar');
const { decisaoEmAndamento, travarFicha, liberarFicha } = require('./trava');
const { abrirRecrutamento, abrirLaudoReprovacao } = require('./fluxo');
const { registrarFicha, decidirFicha } = require('./fichas');
const { registrarSinal } = require('../confianca/servico');
const tema = require('../../tema');
const { registrarModulo } = require('../modulos');
const utils = require('../formatarNick');

// modal_recrutamento
registrarModulo('modal_recrutamento', async interaction => {
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
        color: tema.cor.primaria, // vermelho
        description: '⚠️ **ERRO:** O CAMPO **ID FIVEM** DEVE CONTER APENAS NÚMEROS.\n\nPOR FAVOR, REFAÇA O FORMULÁRIO DE RECRUTAMENTO PREENCHENDO CORRETAMENTE.'
      }],
      flags: 64
    });
  }
  // Validação: Idade deve conter apenas números e até 2 dígitos
  if (!/^[0-9]{1,2}$/.test(idade)) {
    return interaction.reply({
      embeds: [{
        color: tema.cor.primaria,
        description: '⚠️ **ERRO:** O CAMPO **IDADE** DEVE CONTER APENAS NÚMEROS E TER NO MÁXIMO 2 DÍGITOS.\n\nPOR FAVOR, REFAÇA O FORMULÁRIO DE RECRUTAMENTO PREENCHENDO CORRETAMENTE.'
      }],
      flags: 64
    });
  }
  // Validação: Telefone deve conter apenas números, com 10 ou 11 dígitos
  if (!/^\d{10,11}$/.test(telefone)) {
    return interaction.reply({
      embeds: [{
        color: tema.cor.primaria,
        description: '⚠️ **ERRO:** O CAMPO **TELEFONE** DEVE CONTER APENAS NÚMEROS, COM 10 OU 11 DÍGITOS.\nEXEMPLO: 11912345678\n\nPOR FAVOR, REFAÇA O FORMULÁRIO DE RECRUTAMENTO PREENCHENDO CORRETAMENTE.'
      }],
      flags: 64
    });
  }
  const canalRecrutamento = interaction.guild.channels.cache.get(config.canais.recrutamento);
  if (!canalRecrutamento) return interaction.reply({ content: 'CANAL DE RECRUTAMENTO NÃO ENCONTRADO.', flags: 64 });
  const embed = {
    color: tema.cor.primaria,
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
});

// abrir_recrutamento
registrarModulo('abrir_recrutamento', async interaction => {
  await abrirRecrutamento(interaction);
  return;
});

// reprovar_recrutamento
registrarModulo('reprovar_recrutamento', async interaction => {
  await abrirLaudoReprovacao(interaction);
  return;
});

// aprovar_recrutamento
registrarModulo('aprovar_recrutamento', async interaction => {
  const { client } = interaction;
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
    const telefoneField = embed.fields.find(f => f.name === 'TELEFONE');
    const nome = nomeField ? nomeField.value : '';
    const id_fivem = idFiveMField ? idFiveMField.value : '';
    const telefone = telefoneField ? telefoneField.value : '';
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
    const db = require('../db');
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
      // Divulgar telefone do novo sócio no canal telefone-narnia
      const canalTelefoneSocio = interaction.guild.channels.cache.get(config.canais.telefoneSocio);
      if (canalTelefoneSocio) {
        await canalTelefoneSocio.send({
          content: `📞 NOVO SÓCIO APROVADO: **${nome}** (ID FIVEM ${id_fivem}) — <@${candidatoId}>\nTELEFONE: **${telefone}**`
        }).catch(err => console.error('[aprovar] Erro ao enviar telefone para o canal de telefone dos sócios:', err));
      } else {
        console.error('Canal de telefone dos sócios não encontrado!');
      }
      // Convite do WhatsApp NÃO é mais automático aqui — passou a ser disparo
      // manual pelo painel 📲・convite-whatsapp (botão pra um sócio ou pra
      // todos), pedido do usuário em 2026-09-21 pra não notificar em massa a
      // cada aprovação e poder validar o fluxo do painel manualmente primeiro.
    } catch (err) {
      console.error('Erro ao registrar aprovação no banco:', err);
      await interaction.channel.send({
        content: `⚠️ NÃO FOI POSSÍVEL ATRIBUIR/REMOVER CARGOS OU REGISTRAR APROVAÇÃO DE <@${candidatoId}>. VERIFIQUE SE O USUÁRIO ESTÁ NO SERVIDOR E SE O BOT TEM PERMISSÃO.\n\nERRO TÉCNICO: ${err.message}`
      });
      return;
    }
    // Montar embed de aprovação com borda preta e campo de status
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
      color: tema.cor.primaria
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
});
