const { ActionRowBuilder, UserSelectMenuBuilder } = require('discord.js');
const config = require('../../config/index.js');
const { registrarModulo } = require('../modulos');
const repo = require('./repositorio');
const { montarMensagemEvento, atualizarMensagemEvento } = require('./mensagem');
const { podeGerirEvento } = require('./permissoes');

// Botões da mensagem do evento: evt:confirmar:<id> · evt:desistir:<id> · evt:presenca:<id>
// e o seletor de presentes evt:presentes:<id>

// Outros módulos (confiança) escutam presença sem o evento conhecê-los
const ouvintesPresenca = [];
function aoMarcarPresenca(fn) {
  ouvintesPresenca.push(fn);
}

async function notificarPresenca({ evento, discordIds, client }) {
  if (!discordIds.length) return;
  for (const ouvinte of ouvintesPresenca) {
    await ouvinte({ evento, discordIds, client }).catch(err => console.error('[eventos] Erro em ouvinte de presença:', err));
  }
}

async function avisarPorDM(client, discordId, conteudo) {
  try {
    const usuario = await client.users.fetch(discordId);
    await usuario.send(conteudo);
  } catch {
    // DM fechada
  }
}

const MENSAGENS_ERRO = {
  nao_encontrado: '❌ EVENTO NÃO ENCONTRADO.',
  fechado: '⏳ AS INSCRIÇÕES DESTE EVENTO ESTÃO ENCERRADAS.',
  nao_inscrito: '⚠️ VOCÊ NÃO ESTÁ INSCRITO NESTE EVENTO.',
};

async function confirmar(interaction, eventoId) {
  if (!interaction.member.roles.cache.has(config.cargos.socio)) {
    return interaction.reply({ content: '❌ SÓ SÓCIOS PODEM CONFIRMAR PRESENÇA NOS EVENTOS DA TORCIDA.', flags: 64 });
  }
  await interaction.deferUpdate();
  const r = await repo.inscrever(eventoId, interaction.user.id);
  if (r.evento) await interaction.editReply(montarMensagemEvento(r.evento, await repo.listarInscricoes(eventoId)));

  let texto;
  if (r.erro === 'ja_inscrito') texto = r.status === 'ESPERA' ? '⏳ VOCÊ JÁ ESTÁ NA LISTA DE ESPERA.' : '✅ VOCÊ JÁ ESTÁ CONFIRMADO.';
  else if (r.erro) texto = MENSAGENS_ERRO[r.erro];
  else texto = r.status === 'ESPERA'
    ? '⏳ AS VAGAS ESTÃO PREENCHIDAS: VOCÊ ENTROU NA LISTA DE ESPERA. SE ALGUÉM DESISTIR, VOCÊ SOBE E É AVISADO POR DM.'
    : '✅ PRESENÇA CONFIRMADA!';
  return interaction.followUp({ content: texto, flags: 64 });
}

async function desistir(interaction, eventoId) {
  await interaction.deferUpdate();
  const r = await repo.desistir(eventoId, interaction.user.id);
  if (r.evento) await interaction.editReply(montarMensagemEvento(r.evento, await repo.listarInscricoes(eventoId)));
  if (r.erro) return interaction.followUp({ content: MENSAGENS_ERRO[r.erro], flags: 64 });

  if (r.promovido) {
    await avisarPorDM(interaction.client, r.promovido, {
      content: `✅ Abriu uma vaga e você saiu da lista de espera: sua presença em **${r.evento.titulo}** está confirmada. <t:${Math.floor(new Date(r.evento.inicio_em).getTime() / 1000)}:F>`,
    });
  }
  return interaction.followUp({ content: '👋 VOCÊ SAIU DESTE EVENTO.', flags: 64 });
}

async function abrirPresenca(interaction, eventoId) {
  const evento = await repo.buscarEvento(eventoId);
  if (!evento || evento.status === 'CANCELADO') return interaction.reply({ content: MENSAGENS_ERRO.nao_encontrado, flags: 64 });
  if (!(await podeGerirEvento(interaction.member, evento))) {
    return interaction.reply({ content: '❌ SÓ QUEM ORGANIZA ESTE EVENTO (LIDERANÇA, CRIADOR OU GESTOR DA ÁREA) MARCA PRESENÇA.', flags: 64 });
  }
  const select = new UserSelectMenuBuilder()
    .setCustomId(`evt:presentes:${eventoId}`)
    .setPlaceholder('SELECIONE QUEM ESTÁ PRESENTE')
    .setMinValues(1)
    .setMaxValues(25);
  return interaction.reply({
    content: `**📋 PRESENÇA — ${evento.titulo.toUpperCase()}**\nMarque quem compareceu (até 25 por vez). Quem veio sem confirmar também conta.`,
    components: [new ActionRowBuilder().addComponents(select)],
    flags: 64,
  });
}

async function registrarPresentes(interaction, eventoId) {
  const evento = await repo.buscarEvento(eventoId);
  if (!evento || !(await podeGerirEvento(interaction.member, evento))) {
    return interaction.update({ content: '❌ SEM PERMISSÃO PARA MARCAR PRESENÇA NESTE EVENTO.', components: [] });
  }
  await interaction.deferUpdate();
  const novos = await repo.marcarPresenca(eventoId, interaction.values, interaction.user.id);
  await atualizarMensagemEvento(interaction.client, eventoId).catch(err => console.error('[eventos] Erro ao atualizar mensagem:', err));
  await notificarPresenca({ evento, discordIds: novos, client: interaction.client });
  return interaction.editReply({
    content: `📋 ${novos.length} PRESENÇA${novos.length !== 1 ? 'S' : ''} REGISTRADA${novos.length !== 1 ? 'S' : ''}${interaction.values.length > novos.length ? ` (${interaction.values.length - novos.length} já estava${interaction.values.length - novos.length !== 1 ? 'm' : ''} marcada${interaction.values.length - novos.length !== 1 ? 's' : ''})` : ''}.`,
    components: [],
  });
}

registrarModulo('evt', async interaction => {
  const [, acao, eventoId] = interaction.customId.split(':');
  if (interaction.isButton() && acao === 'confirmar') return confirmar(interaction, eventoId);
  if (interaction.isButton() && acao === 'desistir') return desistir(interaction, eventoId);
  if (interaction.isButton() && acao === 'presenca') return abrirPresenca(interaction, eventoId);
  if (interaction.isUserSelectMenu() && acao === 'presentes') return registrarPresentes(interaction, eventoId);
});

module.exports = { aoMarcarPresenca, notificarPresenca, avisarPorDM };
