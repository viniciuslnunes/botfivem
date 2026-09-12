const { ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder, StringSelectMenuBuilder } = require('discord.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca, ehPresidencia } = require('../permissoes');
const { papelNaArea } = require('./acesso');
const { mudarArea } = require('./gestao');
// Import tardio (dentro da função) evita ciclo: quadro.js usa linhaBotaoQuadro,
// que mora aqui por já ser o módulo dos botões de departamento.

// Botões nos canais de área: dept:incluir/remover:<slug> → seletor de pessoa
// → (se presidência) seletor de papel → mudarArea. Tudo ephemeral (flags: 64).
// A permissão é sempre conferida de novo aqui, nunca só pelo botão estar visível.

async function podeMexerNaArea(member, slug) {
  return ehPresidencia(member) || (await papelNaArea(member, slug)) === 'gestor';
}

function linhaBotoesArea(slug) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`dept:incluir:${slug}`).setLabel('Incluir').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`dept:remover:${slug}`).setLabel('Remover').setEmoji('➖').setStyle(ButtonStyle.Danger)
  );
}

async function abrirSeletorPessoa(interaction, acao, slug) {
  if (!(await podeMexerNaArea(interaction.member, slug))) {
    return interaction.reply({ content: '❌ SÓ A PRESIDÊNCIA OU O GESTOR DESTA ÁREA MEXE EM QUEM PARTICIPA.', flags: 64 });
  }
  const select = new UserSelectMenuBuilder().setCustomId(`dept:${acao}-pessoa:${slug}`)
    .setPlaceholder(acao === 'incluir' ? 'QUEM ENTRA NA ÁREA?' : 'QUEM SAI DA ÁREA?');
  return interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
}

async function finalizarMudanca(interaction, acao, slug, usuario, papel) {
  await interaction.deferUpdate();
  const mensagem = await mudarArea(interaction, { acao, slug, usuario, papel });
  return interaction.editReply({ content: mensagem, components: [], allowedMentions: { parse: [] } });
}

registrarModulo('dept', async interaction => {
  const [, acao, slugOuId] = interaction.customId.split(':');

  if (interaction.isButton() && acao === 'quadro-atualizar') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: '❌ SÓ A LIDERANÇA ATUALIZA O QUADRO.', flags: 64 });
    await interaction.deferReply({ flags: 64 });
    await require('./quadro').atualizarQuadroDepartamentos(interaction.client);
    return interaction.editReply({ content: '🦅 QUADRO ATUALIZADO.' });
  }

  if (interaction.isButton() && (acao === 'incluir' || acao === 'remover')) {
    return abrirSeletorPessoa(interaction, acao, slugOuId);
  }

  if (interaction.isUserSelectMenu() && (acao === 'incluir-pessoa' || acao === 'remover-pessoa')) {
    const slug = slugOuId;
    if (!(await podeMexerNaArea(interaction.member, slug))) {
      return interaction.update({ content: '❌ SÓ A PRESIDÊNCIA OU O GESTOR DESTA ÁREA MEXE EM QUEM PARTICIPA.', components: [] });
    }
    const usuario = interaction.users.first();
    if (acao === 'remover-pessoa') return finalizarMudanca(interaction, 'remover', slug, usuario);

    // Só a presidência escolhe o papel (gestor); o gestor da área só inclui como membro
    if (!ehPresidencia(interaction.member)) return finalizarMudanca(interaction, 'incluir', slug, usuario, 'membro');
    const select = new StringSelectMenuBuilder().setCustomId(`dept:papel:${slug}:${usuario.id}`)
      .setPlaceholder('COM QUE PAPEL NESTA ÁREA?')
      .addOptions(
        { label: 'Membro', value: 'membro', emoji: '👤' },
        { label: 'Gestor', value: 'gestor', emoji: '👑' }
      );
    return interaction.update({ content: `Incluir ${usuario} — com que papel?`, components: [new ActionRowBuilder().addComponents(select)] });
  }

  if (interaction.isStringSelectMenu() && acao === 'papel') {
    const [, , slug, usuarioId] = interaction.customId.split(':');
    if (!ehPresidencia(interaction.member)) {
      return interaction.update({ content: '❌ SÓ A PRESIDÊNCIA DEFINE GESTOR DE ÁREA.', components: [] });
    }
    return finalizarMudanca(interaction, 'incluir', slug, { id: usuarioId }, interaction.values[0]);
  }
});

module.exports = { linhaBotoesArea };
