// Botões dos alertas da inteligência (customId `intel:<acao>:<casoId>`). Só a liderança age
// (conferido aqui, não só escondendo botão); "resolvido" só depois da ação ter funcionado; o caso
// só fecha uma vez (guarda no SQL). Ação destrutiva pede confirmação num segundo clique.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const config = require('../../config/index.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const tema = require('../../tema');
const casos = require('./casos');

const responder = (interaction, conteudo) => interaction.reply({ content: conteudo, flags: 64, allowedMentions: { parse: [] } });

async function membroDoCaso(interaction, caso) {
  if (!caso.alvo_discord_id) return null;
  return interaction.guild.members.fetch(caso.alvo_discord_id).catch(() => null);
}

// Fecha o caso e atualiza a mensagem do alerta; devolve false se outra pessoa já fechou
async function concluir(interaction, caso, status, resolucao) {
  const fechado = await casos.fechar(caso.id, status, { porId: interaction.user.id, resolucao });
  if (!fechado) return false;
  const rotulo = { RESOLVIDO: '✔️ resolvido', IGNORADO: `${tema.emoji.recusado} ignorado` }[status] ?? status.toLowerCase();
  await casos.encerrarMensagem(interaction.client, fechado, `${rotulo} por ${interaction.member?.displayName ?? interaction.user.username}${resolucao ? ` — ${resolucao}` : ''}`);
  return true;
}

// ── Ações específicas de cada tipo (cada uma devolve o texto da resolução, ou lança erro) ──

async function removerSocio(interaction, caso) {
  const membro = await membroDoCaso(interaction, caso);
  if (!membro) return 'membro já não está no servidor';
  if (!membro.roles.cache.has(config.cargos.socio)) return 'já não tinha o cargo de sócio';
  await membro.roles.remove(config.cargos.socio, `Inteligência: saiu da torcida no jogo (caso #${caso.id}, por ${interaction.user.tag ?? interaction.user.id})`);
  return 'cargo de sócio removido';
}

async function ajustarCargo(interaction, caso) {
  const membro = await membroDoCaso(interaction, caso);
  if (!membro) return 'membro já não está no servidor';
  const deve = Boolean(caso.dados?.promovido);
  const tem = membro.roles.cache.has(config.cargos.recrutador);
  if (deve === tem) return 'cargo já estava coerente com o jogo';
  const motivo = `Inteligência: cargo de recrutador alinhado ao jogo (caso #${caso.id})`;
  if (deve) await membro.roles.add(config.cargos.recrutador, motivo);
  else await membro.roles.remove(config.cargos.recrutador, motivo);
  return deve ? 'cargo de recrutador concedido' : 'cargo de recrutador removido';
}

// O bloqueio em si é o fluxo que já existe (modal_bloquearid): o caso só abre o modal com o ID pronto.
// Fecha sozinho quando o ID aparecer na lista (resolução automática da varredura).
async function abrirModalBloqueio(interaction, caso) {
  const idFivem = String(caso.dados?.idFivem ?? '');
  const modal = new ModalBuilder().setCustomId('modal_bloquearid').setTitle('BLOQUEAR NOVO ID — NÃO RECRUTAR');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('id').setLabel('ID FIVEM PARA BLOQUEAR')
      .setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(8).setValue(idFivem.slice(0, 8))),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('motivo').setLabel('MOTIVO DO BLOQUEIO')
      .setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(3).setMaxLength(100).setValue('Blacklist no jogo')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('prova').setLabel('PROVA (OPCIONAL, LINK OU INFO)')
      .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100))
  );
  await interaction.showModal(modal);
}

async function tratar(interaction) {
  if (!interaction.isButton()) return;
  if (!ehLideranca(interaction.member)) return responder(interaction, MSG_SO_LIDERANCA);

  const [, acao, idTxt] = interaction.customId.split(':');
  const caso = await casos.buscar(Number(idTxt));
  if (!caso) return responder(interaction, '⚠️ CASO NÃO ENCONTRADO.');
  if (caso.status !== 'ABERTO') return responder(interaction, `⚠️ ESTE CASO JÁ ESTÁ ${caso.status}.`);

  if (acao === 'res' || acao === 'ign') {
    const ok = await concluir(interaction, caso, acao === 'res' ? 'RESOLVIDO' : 'IGNORADO', null);
    return responder(interaction, ok ? (acao === 'res' ? '✔️ Caso resolvido.' : `${tema.emoji.recusado} Caso ignorado.`) : '⚠️ OUTRA PESSOA JÁ FECHOU ESTE CASO.');
  }

  if (acao === 'blq') return abrirModalBloqueio(interaction, caso);

  if (acao === 'rem') {
    // Destrutivo: pede confirmação (segundo clique) antes de mexer no cargo
    const confirmar = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`intel:remc:${caso.id}`).setLabel('CONFIRMAR REMOÇÃO').setEmoji('🚪').setStyle(ButtonStyle.Danger)
    );
    return interaction.reply({
      content: caso.tipo === 'restricao_com_pendencia'
        ? `Remover o cargo de sócio de <@${caso.alvo_discord_id}>? Ele tem pagamento de 2ª ADV pendente e ${caso.dados?.restricao ?? 'restrição'} ativa no jogo.`
        : `Remover o cargo de sócio de <@${caso.alvo_discord_id}>? A saída no jogo já foi registrada; confirme que não é troca de conta.`,
      components: [confirmar], flags: 64, allowedMentions: { parse: [] },
    });
  }

  if (acao === 'remc' || acao === 'adj') {
    let resolucao;
    try {
      resolucao = acao === 'remc' ? await removerSocio(interaction, caso) : await ajustarCargo(interaction, caso);
    } catch (err) {
      console.error('[inteligencia] Ação do caso falhou (nada foi marcado como resolvido):', err);
      return responder(interaction, '❌ O DISCORD RECUSOU A AÇÃO (PERMISSÃO OU POSIÇÃO DO CARGO). O CASO CONTINUA ABERTO.');
    }
    const ok = await concluir(interaction, caso, 'RESOLVIDO', resolucao);
    return responder(interaction, ok ? `✔️ ${resolucao}.` : '⚠️ OUTRA PESSOA JÁ FECHOU ESTE CASO.');
  }
}

registrarModulo('intel', tratar);

module.exports = { tratar, removerSocio, ajustarCargo };
