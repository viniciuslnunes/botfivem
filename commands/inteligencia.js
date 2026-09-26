const { SlashCommandBuilder } = require('discord.js');
const { ehLideranca, ehPresidencia, MSG_SO_LIDERANCA } = require('../utils/permissoes');

const SECOES = [
  ['casos', 'Fila de alertas abertos e o que os alertas rendem'],
  ['risco', 'Associados em risco (ou o resumo de um associado)'],
  ['esfriando', 'Sócios com a atividade em queda'],
  ['recrutamento', 'Funil completo, tempo de análise e qualidade de quem aprova'],
  ['manto', 'Provagem de manto: acertos, erros, motivos e casos abertos'],
  ['cobertura', 'Horas em que chega ficha e não há recrutador no jogo'],
  ['retencao', 'Coortes de recrutamento, saídas e tempo de casa'],
  ['disciplina', 'A advertência funciona? Pagamento, saída e reincidência'],
  ['contribuicao', 'Quem põe × quem tira do baú e do banco'],
  ['patrimonio', 'Onde está cada peça do patrimônio e empréstimos atrasados'],
  ['financas', 'Livro-caixa, loja e rifas'],
  ['farm', 'Produtividade por hora e concentração do farm'],
  ['eventos', 'Faltas em eventos e melhores horários'],
  ['territorio', 'Conquistas de território × horários com gente online'],
  ['tickets', 'Volume e tempo de atendimento dos tickets'],
  ['departamentos', 'Saúde dos departamentos: membros ativos e gestor'],
];

const builder = new SlashCommandBuilder()
  .setName('inteligencia')
  .setDescription('Cruzamentos entre Discord e logs do jogo (liderança)');
for (const [nome, descricao] of SECOES) {
  builder.addSubcommand(s => {
    s.setName(nome).setDescription(descricao);
    if (nome === 'risco') s.addUserOption(o => o.setName('membro').setDescription('Resumo de um associado (padrão: ranking de risco)'));
    return s;
  });
}
builder.addSubcommand(s => s.setName('lideranca').setDescription('Consistência da liderança nos últimos 30 dias (só presidência)'));
builder.addSubcommand(s => s.setName('boletim').setDescription('Publicar agora o boletim semanal no canal de inteligência'));

module.exports = {
  data: builder,

  async execute(interaction) {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const sub = interaction.options.getSubcommand();
    if (sub === 'lideranca' && !ehPresidencia(interaction.member)) {
      return interaction.reply({ content: '❌ APENAS A PRESIDÊNCIA (PRESIDENTE E VICE) PODE VER A CONSISTÊNCIA DA LIDERANÇA.', flags: 64 });
    }
    await interaction.deferReply({ flags: 64 });

    const rel = require('../utils/inteligencia/relatorios');
    const relatoriosJogo = require('../utils/logsJogo/relatorios');
    const tempoJogadoPorId = periodo => relatoriosJogo.tempoJogadoPorId(periodo);
    const carregarSocios = () => require('../utils/inteligencia/pessoas').carregarSocios(interaction.client);

    if (sub === 'boletim') {
      const canal = await require('../utils/inteligencia/canais').garantirCanalInteligencia(interaction.client);
      const n = await require('../utils/inteligencia/boletim').publicarBoletim(interaction.client, { canal });
      return interaction.editReply({ content: `🧠 Boletim publicado em ${canal} (${n} seções).` });
    }

    let embed;
    if (sub === 'risco') {
      const alvo = interaction.options.getUser('membro');
      if (alvo) {
        const membro = await interaction.guild.members.fetch(alvo.id).catch(() => null);
        const { situacaoDe } = require('../utils/confianca/servico');
        const regrasConfianca = require('../utils/confianca/regras');
        const s = await situacaoDe(alvo.id, membro);
        embed = await rel.embedFichaAssociado(alvo.id, `${regrasConfianca.rotuloNivel(s.nivel)} (${s.score}/100)`);
      } else {
        embed = await rel.embedRisco();
      }
    } else if (sub === 'casos') embed = await rel.embedCasos();
    else if (sub === 'esfriando') embed = await rel.embedEsfriando();
    else if (sub === 'recrutamento') embed = await rel.embedRecrutamento();
    else if (sub === 'manto') embed = await rel.embedManto();
    else if (sub === 'contribuicao') embed = await rel.embedContribuicao();
    else if (sub === 'cobertura') embed = await rel.embedCobertura({ recrutadoresIds: rel.recrutadoresIdsDe((await carregarSocios()).socios) });
    else if (sub === 'retencao') embed = await rel.embedRetencao();
    else if (sub === 'disciplina') embed = await rel.embedDisciplina();
    else if (sub === 'patrimonio') embed = await rel.embedPatrimonio();
    else if (sub === 'financas') embed = await rel.embedFinancas();
    else if (sub === 'farm') embed = await rel.embedFarm({ tempoJogadoPorId, socios: (await carregarSocios()).socios });
    else if (sub === 'eventos') embed = await rel.embedEventos({ socios: (await carregarSocios()).socios });
    else if (sub === 'territorio') embed = await rel.embedTerritorio();
    else if (sub === 'tickets') embed = await rel.embedTickets();
    else if (sub === 'lideranca') embed = await rel.embedLideranca();
    else {
      const { socios } = await carregarSocios();
      embed = await rel.embedDepartamentos(interaction.client, { tempoJogadoPorId, socios });
    }
    return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
