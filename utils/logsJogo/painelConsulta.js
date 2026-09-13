const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const E = require('./estatisticas');

// Filtro por período dos canais-painel de log, num módulo só. Cada painel
// registra como desenha o período escolhido (`registrarConsulta`) e ganha um
// select pronto (`selectPeriodo`) — em vez de oito handlers de interação quase
// iguais, um handler com um registro de renderizadores.
//
// O que o select responde é ephemeral (só quem clicou vê), como no painel de
// jogadores: o canal continua sendo a foto do estado atual, e o recorte por
// período é consulta de quem perguntou.

// Mesma lista (e mesma ordem: do mais recente/curto pro mais antigo/longo) do
// painel de jogadores. "Ontem" fica de fora aqui: nestes painéis a pergunta é
// sempre "quanto nos últimos N dias", não "o que houve num dia civil".
const PERIODOS = [
  { chave: 'hoje', label: 'HOJE' },
  { chave: '7d', label: 'ÚLTIMOS 7 DIAS' },
  { chave: '30d', label: 'ÚLTIMOS 30 DIAS' },
  { chave: '90d', label: 'ÚLTIMOS 90 DIAS' },
  { chave: '365d', label: 'ÚLTIMOS 12 MESES' },
  { chave: 'tudo', label: 'TODO O HISTÓRICO' },
];

// slug → { renderizar(periodo) => { embeds }, resetar(client) }
const consultas = new Map();

function registrarConsulta(slug, renderizar, resetar = null) {
  consultas.set(slug, { renderizar, resetar });
}

function selectPeriodo(slug, placeholder) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`logstat:${slug}`)
      .setPlaceholder(placeholder)
      .addOptions(PERIODOS.map(p => ({ label: p.label, value: p.chave })))
  );
}

registrarModulo('logstat', async interaction => {
  if (!interaction.isStringSelectMenu()) return;
  const slug = interaction.customId.split(':')[1];
  const consulta = consultas.get(slug);
  if (!consulta) return;
  if (!ehLideranca(interaction.member)) {
    return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
  }

  await interaction.deferReply({ flags: 64 });
  const periodo = E.resolverPeriodo(interaction.values[0]);
  const resposta = await consulta.renderizar(periodo);
  await interaction.editReply({ ...resposta, allowedMentions: { parse: [] } });

  // Sem isso o Discord deixa a opção escolhida marcada no select pra sempre,
  // como se aquele recorte fosse o estado do painel (não é: o painel é o agora).
  // Debounced no próprio painel, então vários cliques viram uma edição só.
  consulta.resetar?.(interaction.client);
});

module.exports = { registrarConsulta, selectPeriodo, PERIODOS };
