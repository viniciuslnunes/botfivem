const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, LabelBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
} = require('discord.js');
const config = require('../../config/index.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const { criarPainelCanal } = require('../logsJogo/painelCanal');
const { garantirMembrosCarregados } = require('../membrosGuild');
const { obterLink, definirLink, enviarConvitePara } = require('./conviteWhatsapp');

// Canal 📲・convite-whatsapp: reenvia o convite do grupo de sócios no WhatsApp
// por DM — pra um sócio específico ou pra todos de uma vez — e deixa trocar o
// link ali mesmo, sem mexer no código/redeploy. Só liderança vê (padrão do
// criarPainelCanal): o link nunca pode circular fora de quem já é sócio — a
// guarda de verdade mora em conviteWhatsapp.enviarConvitePara, chamada em
// todo disparo (aqui, no comando /convitewhatsapp e na aprovação automática).
// Fluxo botão→select→modal (ver padrão): ALTERAR LINK abre modal direto
// (edição de um valor só); ENVIAR PRA UM SÓCIO abre select de membro.
const SLUG = 'convite_whatsapp';
const INTERVALO_MS = 400;
const aguardar = ms => new Promise(resolve => setTimeout(resolve, ms));

async function montarBlocos() {
  const link = await obterLink();
  return [{
    embeds: [{
      color: 0x25D366,
      title: '📲 CONVITE DO GRUPO DE WHATSAPP — SÓCIOS',
      description: 'Reenvia o link do grupo de sócios no WhatsApp por DM.\n'
        + '**Nunca é enviado pra quem não tem cargo de sócio pra cima** (visitante, provar-manto).',
      fields: [{ name: 'LINK ATUAL', value: link }],
    }],
  }];
}

function montarAcao() {
  return {
    content: '👇 ESCOLHA UMA AÇÃO',
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('convitewa:um').setLabel('ENVIAR PRA UM SÓCIO').setEmoji('📩').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('convitewa:todos').setLabel('ENVIAR PRA TODOS OS SÓCIOS').setEmoji('📢').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('convitewa:alterar').setLabel('ALTERAR LINK').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    )],
  };
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '📲・convite-whatsapp',
  razao: 'Painel para enviar e alterar o convite do grupo de sócios no WhatsApp',
  intervaloMin: 60,
  canalVizinhoId: config.canais.telefoneNarnia,
  montarBlocos,
  montarAcao,
});

function abrirSelectMembro(interaction) {
  return interaction.reply({
    content: '👇 SELECIONE O SÓCIO QUE VAI RECEBER O CONVITE',
    components: [new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId('convitewa:selum').setPlaceholder('SELECIONE UM MEMBRO').setMinValues(1).setMaxValues(1)
    )],
    flags: 64,
  });
}

async function enviarParaUm(interaction) {
  await interaction.deferReply({ flags: 64 });
  const membro = interaction.members.first();
  if (!membro) return interaction.editReply({ content: '❌ MEMBRO NÃO ENCONTRADO.' });
  const link = await obterLink();
  const resultado = await enviarConvitePara(membro, link);
  const msgs = {
    enviado: `✅ Convite enviado por DM para ${membro}.`,
    sem_cargo: `❌ ${membro} não tem cargo de sócio pra cima — convite NÃO enviado (evita vazar o grupo pra fora da torcida).`,
    falhou: `⚠️ Não consegui mandar DM para ${membro} (DM fechada).`,
  };
  return interaction.editReply({ content: msgs[resultado], allowedMentions: { parse: [] } });
}

async function enviarParaTodos(interaction) {
  await interaction.deferReply({ flags: 64 });
  await garantirMembrosCarregados(interaction.guild);
  const link = await obterLink();
  const membros = [...interaction.guild.members.cache.values()].filter(m => !m.user.bot);
  await interaction.editReply({ content: `⏳ Enviando para até ${membros.length} membros (só quem tem cargo de sócio pra cima recebe)...` });

  let enviados = 0;
  let semCargo = 0;
  let falharam = 0;
  for (const membro of membros) {
    const resultado = await enviarConvitePara(membro, link);
    if (resultado === 'enviado') enviados++;
    else if (resultado === 'falhou') falharam++;
    else semCargo++;
    await aguardar(INTERVALO_MS);
  }

  return interaction.editReply({
    content: `📢 CONVITE ENVIADO A TODOS OS SÓCIOS.\n✅ ${enviados} receberam.\n⚠️ ${falharam} com DM fechada.\n(${semCargo} membros ignorados por não terem cargo de sócio pra cima.)`
  });
}

function modalAlterarLink(linkAtual) {
  const modal = new ModalBuilder().setCustomId('convitewa:alterarmodal').setTitle('ALTERAR LINK DO WHATSAPP');
  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Novo link do grupo')
      .setDescription('Cole o link completo (https://chat.whatsapp.com/...)')
      .setTextInputComponent(
        new TextInputBuilder().setCustomId('link').setStyle(TextInputStyle.Short).setRequired(true)
          .setMaxLength(200).setValue(linkAtual)
      )
  );
  return modal;
}

async function alterarLink(interaction) {
  const novoLink = interaction.fields.getTextInputValue('link').trim();
  if (!/^https:\/\//i.test(novoLink)) {
    return interaction.reply({ content: '❌ O LINK PRECISA COMEÇAR COM https://', flags: 64 });
  }
  await definirLink(novoLink);
  painel.atualizar(interaction.client).catch(err => console.error(`[${SLUG}] Erro ao atualizar painel após trocar o link:`, err));
  return interaction.reply({ content: `✅ LINK ATUALIZADO:\n${novoLink}`, flags: 64 });
}

registrarModulo('convitewa', async interaction => {
  if (!ehLideranca(interaction.member)) {
    return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
  }
  const [, acao] = interaction.customId.split(':');
  if (acao === 'um' && interaction.isButton()) return abrirSelectMembro(interaction);
  if (acao === 'selum' && interaction.isUserSelectMenu()) return enviarParaUm(interaction);
  if (acao === 'todos' && interaction.isButton()) return enviarParaTodos(interaction);
  if (acao === 'alterar' && interaction.isButton()) return interaction.showModal(modalAlterarLink(await obterLink()));
  if (acao === 'alterarmodal' && interaction.isModalSubmit()) return alterarLink(interaction);
});

module.exports = { iniciarPainelConviteWhatsapp: painel.iniciar };
