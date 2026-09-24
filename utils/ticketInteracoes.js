// Ticket: abrir (botão → select de categoria), criar o canal e fechar com transcript.
// Veio do antigo events/interactionCreate.js sem mudar a lógica; cada customId
// continua o mesmo, agora roteado por utils/modulos.js.
const { criarCanalTicket, gerarTranscript, CANAL_LOGS, CATEGORIAS } = require('./ticket');
const tema = require('../tema');
const { registrarModulo } = require('./modulos');

// abrir_ticket
registrarModulo('abrir_ticket', async interaction => {
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
});

// select_categoria_ticket
registrarModulo('select_categoria_ticket', async interaction => {
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
    .setDescription(`OLÁ ${interaction.user}, ESTE É O SEU TICKET. NOSSA EQUIPE DA ${tema.marca.nomeCurto} VAI TE ATENDER EM BREVE. POR FAVOR, DESCREVA SEU PROBLEMA OU DÚVIDA.${avisoPrivado}`)
    .setThumbnail(tema.urlLogo())
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
    files: [tema.logo()]
  });

  await interaction.editReply({ content: `🦅 TICKET CRIADO: ${canal}`, components: [] });
  return;
});

// fechar_ticket
registrarModulo('fechar_ticket', async interaction => {
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
});
