const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { registrarModulo } = require('../modulos');
const eventosRepo = require('../eventos/repositorio');
const { avisarPorDM } = require('../eventos/interacoes');
const repo = require('./repositorio');
const { rotuloFuncao } = require('./regras');
const tema = require('../../tema');

// Convite da escala por DM: esc:aceitar:<evento> · esc:recusar:<evento>

const unix = d => Math.floor(new Date(d).getTime() / 1000);

function montarConviteEscala(evento, funcao, convocadorId) {
  return {
    content: `🎖️ <@${convocadorId}> te convocou para trabalhar em **${evento.titulo}** (<t:${unix(evento.inicio_em)}:F>)${evento.local ? ` · 📍 ${evento.local}` : ''}.\nFunção: **${rotuloFuncao(funcao)}**. Você topa?`,
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`esc:aceitar:${evento.id}`).setLabel('ACEITAR').setEmoji(tema.emoji.ok).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`esc:recusar:${evento.id}`).setLabel('NÃO POSSO').setStyle(ButtonStyle.Danger)
    )],
  };
}

registrarModulo('esc', async interaction => {
  const [, acao, eventoId] = interaction.customId.split(':');
  if (!interaction.isButton() || (acao !== 'aceitar' && acao !== 'recusar')) return;

  const evento = await eventosRepo.buscarEvento(eventoId);
  if (!evento || evento.status === 'CANCELADO') {
    return interaction.update({ content: '❌ ESTE EVENTO FOI CANCELADO OU NÃO EXISTE MAIS.', components: [] });
  }
  const linha = await repo.responder(eventoId, interaction.user.id, acao === 'aceitar');
  if (!linha) return interaction.update({ content: '⚠️ VOCÊ NÃO ESTÁ MAIS NA ESCALA DESTE EVENTO.', components: [] });

  const aceitou = linha.status === 'ACEITO';
  if (!aceitou) {
    await avisarPorDM(interaction.client, linha.convocado_por_id, {
      content: `❌ <@${interaction.user.id}> recusou a função **${rotuloFuncao(linha.funcao)}** em **${evento.titulo}**. Rode \`/escala ver\` para cobrir o posto.`,
    });
  }
  return interaction.update({
    content: `${aceitou ? `${tema.emoji.ok} Você está na escala` : `${tema.emoji.recusado} Recusa registrada`}: **${rotuloFuncao(linha.funcao)}** em **${evento.titulo}** (<t:${unix(evento.inicio_em)}:F>).`,
    components: [],
  });
});

module.exports = { montarConviteEscala };
