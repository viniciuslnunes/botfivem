const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const config = require('../config/index.js');
const tema = require('../tema');

const CANAL_LOGS_LIDERANCA = config.canais.logsLideranca;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('testenovato')
    .setDescription('Simula um registro de novato no canal de logs para testar o alerta')
    .addStringOption(opt =>
      opt.setName('nome')
        .setDescription('Nome do novato no jogo')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('id')
        .setDescription('ID FiveM do novato')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const nome = interaction.options.getString('nome') ?? 'Teste Novato';
    const id   = interaction.options.getString('id')   ?? '9999';

    const embedMock = new EmbedBuilder()
      .setColor(tema.cor.neutro)
      .setTitle(`Registro de Atividade: ${nome}`)
      .setDescription(`O Novato **${nome}** (ID: **${id}**) entrou na sua torcida **Novato**.`)
      .setFooter({ text: `Time: ${tema.marca.nomeNormal} | Categoria: lideranca • Hoje às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` });

    try {
      const canal = await interaction.client.channels.fetch(CANAL_LOGS_LIDERANCA);
      await canal.send({ embeds: [embedMock] });
      await interaction.reply({ content: `${tema.emoji.ok} Mock enviado no canal de logs com nome **${nome}** e ID **${id}**.`, flags: 64 });
    } catch (err) {
      await interaction.reply({ content: `❌ Erro ao enviar mock: ${err.message}`, flags: 64 });
    }
  }
};
