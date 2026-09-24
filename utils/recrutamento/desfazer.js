// Desfazer aprovação ou reprovação de uma ficha nos 30 min seguintes à decisão.
// A ficha volta a PENDENTE (mesma mensagem, botões APROVAR/REPROVAR de novo), o candidato
// volta ao estado de quem acabou de pedir (visitante + PROVAR MANTO por 10 min) e tudo que a
// decisão gerou é desfeito: ranking, sinal de confiança e telefone divulgado.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../config/index.js');
const tema = require('../../tema');
const { botoesRecrutamento } = require('../recrutamentoButtons');
const { transacao } = require('../transacao');
const { agendar, registrarTipo } = require('../agendador');
const { ehRecrutadorOuAcima, ehLideranca } = require('../permissoes');
const { atualizarTopRecrutadores } = require('../topRecrutadores');
const { desfazerSinal, sincronizarDepois } = require('../confianca/servico');
const { agendarAtualizacaoReativa: agendarAtualizacaoReprovados } = require('./painelReenvio');
const { textoRegrasManto } = require('./regrasManto');
const { travarFicha, liberarFicha } = require('./trava');
const fichas = require('./fichas');
const regras = require('./regras');

const TIPO_EXPIRAR = 'recrut_expirar_desfazer';
const PROVAR_MANTO_MS = 10 * 60 * 1000;
// Folga para o relógio do banco e o do bot não deixarem o botão preso depois do prazo
const FOLGA_EXPIRAR_MS = 15 * 1000;

function botaoDesfazer(fichaId) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`recrut:desfazer:${fichaId}`)
      .setLabel('DESFAZER DECISÃO')
      .setEmoji('↩️')
      .setStyle(ButtonStyle.Secondary)
  )];
}

// Texto da mensagem da ficha enquanto o botão de desfazer existe
function avisoPrazo(decididoEmMs = Date.now()) {
  const ate = Math.floor((decididoEmMs + regras.JANELA_DESFAZER_MS) / 1000);
  return `↩️ Decisão registrada por engano? Dá para desfazer até <t:${ate}:t> (<t:${ate}:R>).`;
}

// Painel da decisão: botão + aviso + tarefa que tira o botão quando o prazo acaba
async function abrirJanelaDesfazer(fichaId) {
  await agendar(TIPO_EXPIRAR, new Date(Date.now() + regras.JANELA_DESFAZER_MS + FOLGA_EXPIRAR_MS), { fichaId })
    .catch(err => console.error('[recrutamento] Erro ao agendar o fim do prazo de desfazer:', err));
  return { content: avisoPrazo(), components: botaoDesfazer(fichaId) };
}

async function fecharMensagem(client, fichaId) {
  const canal = await client.channels.fetch(config.canais.validarSetagem).catch(() => null);
  const mensagem = canal ? await canal.messages.fetch(fichaId).catch(() => null) : null;
  if (!mensagem) return;
  const temBotao = mensagem.components.some(l => (l.components ?? []).some(c => String(c.customId ?? c.data?.custom_id).startsWith('recrut:desfazer:')));
  if (temBotao) await mensagem.edit({ content: null, components: [] });
}

async function aoExpirar(client, { fichaId }) {
  const ficha = await fichas.buscarFicha(fichaId);
  // Desfeita (e talvez decidida de novo, com prazo próprio e outra tarefa): não mexe
  if (ficha && ['APROVADO', 'REPROVADO'].includes(ficha.status)
    && regras.dentroDaJanelaDesfazer(ficha.decidido_em, Date.now() + FOLGA_EXPIRAR_MS)) return;
  await fecharMensagem(client, fichaId);
}
registrarTipo(TIPO_EXPIRAR, aoExpirar);

async function avisarCandidato(client, discordId, texto) {
  try {
    const usuario = await client.users.fetch(discordId);
    await usuario.send({ embeds: [{ color: tema.cor.primaria, title: tema.titulo('↩️ RECRUTAMENTO'), description: texto }] });
    return true;
  } catch {
    return false;
  }
}

// Candidato volta a ser "quem acabou de pedir": visitante + PROVAR MANTO por 10 min
async function devolverAoProvarManto(guild, membro, avisos) {
  if (config.cargos.visitante) await membro.roles.add(config.cargos.visitante).catch(() => avisos.push('não consegui devolver o cargo de visitante'));
  if (!config.cargos.provarManto) return;
  try {
    await membro.roles.add(config.cargos.provarManto);
  } catch {
    avisos.push('não consegui devolver o cargo PROVAR MANTO');
    return;
  }
  await agendar('remover_cargo', new Date(Date.now() + PROVAR_MANTO_MS), { membroId: membro.id, cargoId: config.cargos.provarManto })
    .catch(err => console.error('[recrutamento] Erro ao agendar remoção do PROVAR MANTO:', err));
  const canal = guild.channels.cache.get(config.canais.provarManto);
  const aviso = await canal?.send({
    content: `<@${membro.id}>, sua solicitação voltou para análise. Você tem 10 minutos para enviar o manto (imagem) aqui neste canal! Após esse prazo, o cargo será removido automaticamente.\n\n${textoRegrasManto()}`,
  }).catch(() => null);
  if (aviso) setTimeout(() => aviso.delete().catch(() => {}), 5 * 60 * 1000).unref?.();
}

async function processarDesfazer(interaction, fichaId) {
  if (!ehRecrutadorOuAcima(interaction.member) && !ehLideranca(interaction.member)) {
    return interaction.reply({ content: '❌ SÓ RECRUTADOR OU LIDERANÇA PODE DESFAZER UMA DECISÃO.', flags: 64 });
  }
  if (!travarFicha(fichaId)) {
    return interaction.reply({ content: '⚠️ OUTRO RECRUTADOR JÁ ESTÁ MEXENDO NESTA SOLICITAÇÃO.', flags: 64 });
  }
  try {
    await interaction.deferReply({ flags: 64 });
    const ficha = await fichas.buscarFicha(fichaId);
    const maisNova = ficha ? await fichas.existeFichaMaisNova(ficha.discord_id, ficha.criado_em) : false;
    const avaliacao = regras.avaliarDesfazer(ficha, { candidatoTemFichaMaisNova: maisNova });
    if (!avaliacao.ok) {
      if (avaliacao.expirada) await fecharMensagem(interaction.client, fichaId).catch(() => {});
      return interaction.editReply({ content: avaliacao.mensagem });
    }

    const eraAprovada = ficha.status === 'APROVADO';
    const membro = await interaction.guild.members.fetch(ficha.discord_id).catch(() => null);

    // Banco e cargo decisivo na mesma transação: se o Discord recusar, nada é desfeito
    let refeita;
    try {
      refeita = await transacao(async conexao => {
        const linha = await fichas.desfazerDecisao(conexao, fichaId, {
          porId: interaction.user.id, statusEsperado: ficha.status, janelaMin: regras.JANELA_DESFAZER_MIN,
        });
        if (!linha) return null;
        if (eraAprovada) {
          await fichas.removerAprovacaoContada(conexao, fichaId, ficha.decidido_por_id);
          await desfazerSinal(conexao, { discordId: ficha.discord_id, sinal: 'APROVACAO', origemTipo: 'ficha', origemId: fichaId });
          if (membro) await membro.roles.remove(config.cargos.socio);
        } else {
          await desfazerSinal(conexao, { discordId: ficha.discord_id, sinal: 'REPROVACAO', origemTipo: 'ficha', origemId: fichaId });
          if (membro && config.cargos.reprovadoRecrutamento) await membro.roles.remove(config.cargos.reprovadoRecrutamento);
        }
        return linha;
      });
    } catch (err) {
      console.error('[recrutamento] Erro ao desfazer decisão:', err);
      return interaction.editReply({ content: `❌ NÃO FOI POSSÍVEL DESFAZER: O DISCORD RECUSOU A TROCA DE CARGO. NADA FOI ALTERADO. VERIFIQUE A PERMISSÃO DO BOT.\n\nERRO TÉCNICO: ${err.message}` });
    }
    if (!refeita) return interaction.editReply({ content: '⚠️ A DECISÃO MUDOU (OU O PRAZO ACABOU) ENQUANTO VOCÊ CLICAVA. NADA FOI ALTERADO.' });

    // Depois do compromisso: o resto é melhor esforço e vira aviso para quem desfez
    const avisos = [];
    if (membro) {
      if (eraAprovada) await membro.setNickname(null).catch(() => avisos.push('não consegui limpar o apelido'));
      await devolverAoProvarManto(interaction.guild, membro, avisos);
    } else {
      avisos.push('o candidato não está mais no servidor (cargos não alterados)');
    }
    if (eraAprovada && ficha.telefone_message_id) {
      const canalTelefone = interaction.guild.channels.cache.get(config.canais.telefoneSocio);
      const msgTelefone = await canalTelefone?.messages.fetch(ficha.telefone_message_id).catch(() => null);
      if (msgTelefone) await msgTelefone.delete().catch(() => avisos.push('não consegui apagar o telefone divulgado'));
      else avisos.push('o telefone divulgado não foi achado para apagar');
    } else if (eraAprovada) {
      avisos.push('o telefone divulgado no canal dos sócios precisa ser apagado à mão');
    }
    await sincronizarDepois(interaction.client, ficha.discord_id);
    if (eraAprovada) atualizarTopRecrutadores(interaction.client).catch(() => {});
    else if (ficha.permite_reenvio === false) agendarAtualizacaoReprovados(interaction.client);

    const embedOriginal = interaction.message.embeds[0];
    await interaction.message.edit({
      content: `↩️ ${eraAprovada ? 'Aprovação' : 'Reprovação'} desfeita por <@${interaction.user.id}>. A solicitação voltou para análise.`,
      embeds: [{
        title: embedOriginal.title || 'Recrutamento',
        description: embedOriginal.description || '',
        fields: regras.camposSemDecisao(embedOriginal.fields),
        color: tema.cor.primaria,
      }],
      components: botoesRecrutamento(),
      allowedMentions: { users: [] },
    }).catch(err => avisos.push(`não consegui reabrir a mensagem da ficha (${err.message})`));

    const avisado = await avisarCandidato(interaction.client, ficha.discord_id, eraAprovada
      ? 'Sua aprovação foi **desfeita** pela equipe de recrutamento e sua solicitação voltou para análise. Envie o manto no canal de provar manto e aguarde a nova decisão.'
      : 'A reprovação da sua solicitação foi **desfeita** pela equipe de recrutamento e ela voltou para análise. Aguarde a nova decisão.');
    if (!avisado) avisos.push('DM do candidato fechada');

    return interaction.editReply({
      content: `↩️ ${eraAprovada ? 'APROVAÇÃO' : 'REPROVAÇÃO'} DESFEITA. A FICHA VOLTOU PARA ANÁLISE.`
        + (avisos.length ? `\n⚠️ Atenção: ${avisos.join('; ')}.` : ''),
    });
  } finally {
    liberarFicha(fichaId);
  }
}

module.exports = { botaoDesfazer, avisoPrazo, abrirJanelaDesfazer, processarDesfazer, aoExpirar, TIPO_EXPIRAR };
