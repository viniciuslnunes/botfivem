const { SlashCommandBuilder } = require('discord.js');
const db = require('../utils/db');
const { gerarCarteirinha } = require('../utils/gerarCarteirinha');
const { atualizarMural } = require('../utils/muralAssociados');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('carteirinha')
    .setDescription('Gera sua carteirinha de sócio dos Gaviões da Fiel - FiveM'),
  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const discordId = interaction.user.id;
    const membro = interaction.member;
    const nome = membro.nickname || interaction.user.displayName || interaction.user.username;

    // Verificar se já tem carteirinha
    let row;
    const existing = await db.query('SELECT * FROM socios WHERE discord_id = $1', [discordId]);

    if (existing.rows.length > 0) {
      row = existing.rows[0];
    } else {
      // Gerar próximo número de sócio
      const maxResult = await db.query('SELECT COALESCE(MAX(numero_socio), 0) AS max FROM socios');
      const proximoNumero = maxResult.rows[0].max + 1;

      // Validade = 1 ano a partir de hoje
      const validade = new Date();
      validade.setFullYear(validade.getFullYear() + 1);

      const insert = await db.query(
        'INSERT INTO socios (discord_id, numero_socio, nome, validade) VALUES ($1, $2, $3, $4) RETURNING *',
        [discordId, proximoNumero, nome, validade.toISOString().split('T')[0]]
      );
      row = insert.rows[0];

      // Atualiza o mural de associados com o novo membro
      atualizarMural(interaction.client).catch(err => console.error('[carteirinha] Erro ao atualizar mural:', err));
    }

    // Formatar validade para DD/MM/AAAA
    const dataValidade = new Date(row.validade);
    const validadeFormatada = dataValidade.toLocaleDateString('pt-BR', { timeZone: 'UTC' });

    // URL do avatar em tamanho maior
    const avatarUrl = interaction.user.displayAvatarURL({ extension: 'png', size: 256 });

    // Gerar imagem
    let buffer;
    try {
      buffer = await gerarCarteirinha({
        nome,
        numeroSocio: row.numero_socio,
        validade: validadeFormatada,
        avatarUrl
      });
    } catch (err) {
      console.error('[carteirinha] Erro ao gerar imagem:', err);
      return interaction.editReply({ content: '❌ Erro ao gerar a carteirinha. Tente novamente.' });
    }

    await interaction.editReply({
      content: `🏆 Sua carteirinha de sócio nº **${String(row.numero_socio).padStart(4, '0')}**!`,
      files: [{ attachment: buffer, name: 'carteirinha.png' }]
    });
  }
};
