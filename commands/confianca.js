const { SlashCommandBuilder } = require('discord.js');
const regras = require('../utils/confianca/regras');
const { situacaoDe } = require('../utils/confianca/servico');

// Nível é visível para qualquer um; score, progresso e sinais só para a própria pessoa.
// Não existe ranking: confiança não é competição.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('confianca')
    .setDescription('Nível de confiança na torcida')
    .addUserOption(o => o.setName('membro').setDescription('Ver o nível de outra pessoa (padrão: você)')),

  async execute(interaction) {
    const usuario = interaction.options.getUser('membro') ?? interaction.user;
    const proprio = usuario.id === interaction.user.id;
    await interaction.deferReply({ flags: 64 });

    const membro = await interaction.guild.members.fetch(usuario.id).catch(() => null);
    const situacao = await situacaoDe(usuario.id, membro);

    if (!proprio) {
      return interaction.editReply({ content: `${usuario} — nível **${regras.rotuloNivel(situacao.nivel)}** na torcida.`, allowedMentions: { parse: [] } });
    }

    const recentes = situacao.eventos.slice(0, 5).map(e =>
      `${e.peso >= 0 ? '➕' : '➖'} ${regras.SINAIS_CONFIANCA[e.sinal]?.rotulo ?? e.sinal} · <t:${Math.floor(new Date(e.criado_em).getTime() / 1000)}:d>`);
    return interaction.editReply({
      embeds: [{
        color: 0x000000,
        title: `${situacao.nivel.emoji} SUA CONFIANÇA NA TORCIDA: ${situacao.nivel.rotulo.toUpperCase()}`,
        description: situacao.progresso
          ? `Faltam **${situacao.progresso.faltam} pontos** para **${regras.rotuloNivel(situacao.progresso.proximo)}**.`
          : 'Você está no nível mais alto.',
        fields: [
          { name: 'COMO SOBE', value: 'Presença marcada em eventos e caravanas, admissão aprovada. Publicar ou reagir não conta.', inline: false },
          { name: 'ÚLTIMOS SINAIS', value: recentes.join('\n') || '*Nenhum sinal ainda.*', inline: false },
        ],
        footer: { text: `Pontuação ${situacao.score}/100 · só você vê este detalhe · confiança não dá permissão` },
      }],
    });
  },
};
