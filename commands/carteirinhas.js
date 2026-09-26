const { SlashCommandBuilder } = require('discord.js');
const db = require('../utils/db');
const config = require('../config/index.js');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../utils/permissoes');
const { registrarLogGestao } = require('../utils/logGestao');
const { situacaoCarteirinha, novaValidadeRenovacao, textoSituacao, formatarDataBR } = require('../utils/carteirinha/regras');
const tema = require('../tema');

const FILTROS = [
  { name: 'Vencendo', value: 'VENCENDO' },
  { name: 'Vencidas', value: 'VENCIDA' },
  { name: 'Vigentes', value: 'VIGENTE' },
  { name: 'Todas', value: 'TODAS' },
];

async function listarSituacao(interaction) {
  const filtro = interaction.options.getString('filtro') ?? 'VENCENDO';
  const { rows } = await db.query('SELECT discord_id, numero_socio, validade FROM socios WHERE revogada_em IS NULL');
  const agora = new Date();
  const itens = rows.map(r => ({ ...r, s: situacaoCarteirinha(r.validade, agora, config.carteirinha.vencendoDias) }));

  const contagem = { VIGENTE: 0, VENCENDO: 0, VENCIDA: 0, SEM_VALIDADE: 0 };
  for (const item of itens) contagem[item.s.situacao]++;

  const filtrados = itens
    .filter(i => filtro === 'TODAS' || i.s.situacao === filtro)
    .sort((a, b) => (a.s.dias ?? Infinity) - (b.s.dias ?? Infinity));
  const linhas = filtrados.slice(0, 40).map(i =>
    `Nº ${String(i.numero_socio).padStart(4, '0')} · <@${i.discord_id}> · ${textoSituacao(i.s)}`);
  if (filtrados.length > 40) linhas.push(`*… e mais ${filtrados.length - 40}*`);

  return interaction.editReply({
    embeds: [{
      color: tema.cor.primaria,
      title: `🪪 CARTEIRINHAS — ${FILTROS.find(f => f.value === filtro).name.toUpperCase()}`,
      description: linhas.join('\n') || '*Nenhuma carteirinha nesta situação.*',
      fields: [
        { name: `${tema.emoji.ativo} VIGENTES`, value: String(contagem.VIGENTE), inline: true },
        { name: `${tema.emoji.alerta} VENCENDO`, value: String(contagem.VENCENDO), inline: true },
        { name: `${tema.emoji.perigo} VENCIDAS`, value: String(contagem.VENCIDA), inline: true },
      ],
      footer: { text: `"Vencendo" = até ${config.carteirinha.vencendoDias} dias para vencer` },
    }],
    allowedMentions: { parse: [] },
  });
}

async function renovar(interaction) {
  const usuario = interaction.options.getUser('membro');
  const alvo = await interaction.guild.members.fetch(usuario.id).catch(() => null);
  const { rows } = await db.query('SELECT numero_socio, validade, revogada_em FROM socios WHERE discord_id = $1', [usuario.id]);
  const carteirinha = rows[0];

  if (!carteirinha) return interaction.editReply({ content: '❌ ESTE MEMBRO AINDA NÃO TEM CARTEIRINHA EMITIDA.' });
  if (carteirinha.revogada_em || !alvo?.roles.cache.has(config.cargos.socio)) {
    return interaction.editReply({ content: '❌ SÓ É POSSÍVEL RENOVAR A CARTEIRINHA DE UM SÓCIO ATIVO.' });
  }

  const novaValidade = novaValidadeRenovacao(carteirinha.validade);
  await db.query(
    `UPDATE socios SET validade = $1, renovada_em = now(), renovada_por_id = $2,
            aviso_vencimento_em = NULL, aviso_vencida_em = NULL
      WHERE discord_id = $3`,
    [novaValidade, interaction.user.id, usuario.id]
  );

  const numero = String(carteirinha.numero_socio).padStart(4, '0');
  await registrarLogGestao(interaction.client, {
    titulo: '🪪 CARTEIRINHA RENOVADA',
    ator: interaction.user.id,
    campos: [
      { name: 'SÓCIO', value: `<@${usuario.id}> · Nº ${numero}`, inline: true },
      { name: 'NOVA VALIDADE', value: formatarDataBR(novaValidade), inline: true },
    ],
  });
  await usuario.send({
    embeds: [{
      color: tema.cor.primaria,
      title: '🪪 CARTEIRINHA RENOVADA',
      description: `Sua carteirinha de sócio nº **${numero}** foi renovada até **${formatarDataBR(novaValidade)}**.`,
    }],
  }).catch(() => {});

  return interaction.editReply({ content: `🦅 CARTEIRINHA Nº **${numero}** DE ${usuario} RENOVADA ATÉ **${formatarDataBR(novaValidade)}**.`, allowedMentions: { parse: [] } });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('carteirinhas')
    .setDescription('Situação e renovação das carteirinhas de sócio (liderança)')
    .addSubcommand(s => s.setName('situacao').setDescription('Lista carteirinhas por situação')
      .addStringOption(o => o.setName('filtro').setDescription('Padrão: vencendo').addChoices(...FILTROS)))
    .addSubcommand(s => s.setName('renovar').setDescription('Renova a carteirinha de um sócio por 1 ano')
      .addUserOption(o => o.setName('membro').setDescription('Sócio').setRequired(true))),

  async execute(interaction) {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    return interaction.options.getSubcommand() === 'renovar' ? renovar(interaction) : listarSituacao(interaction);
  },
};
