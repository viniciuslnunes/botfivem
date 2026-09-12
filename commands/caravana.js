const { SlashCommandBuilder, ActionRowBuilder, UserSelectMenuBuilder } = require('discord.js');
const { registrarModulo } = require('../utils/modulos');
const { registrarLogGestao } = require('../utils/logGestao');
const eventosRepo = require('../utils/eventos/repositorio');
const { podeGerirEvento } = require('../utils/eventos/permissoes');
const { atualizarMensagemEvento } = require('../utils/eventos/mensagem');
const { notificarPresenca } = require('../utils/eventos/interacoes');
const financeiroRepo = require('../utils/financeiro/repositorio');
const { resumirLancamentos } = require('../utils/financeiro/regras');
const { podeVerFinanceiro } = require('../utils/financeiro/permissoes');
const repo = require('../utils/caravana/repositorio');
const { montarManifesto } = require('../utils/caravana/manifesto');

async function carregarCaravana(interaction, eventoId) {
  const evento = await eventosRepo.buscarEvento(eventoId);
  if (!evento || evento.status === 'CANCELADO') return { erro: '❌ CARAVANA NÃO ENCONTRADA OU CANCELADA.' };
  if (evento.tipo !== 'CARAVANA') return { erro: '❌ ESTE EVENTO NÃO É UMA CARAVANA. CRIE COM `/evento criar tipo:Caravana`.' };
  if (!(await podeGerirEvento(interaction.member, evento))) return { erro: '❌ SÓ QUEM ORGANIZA ESTA CARAVANA (LIDERANÇA, CRIADOR OU GESTOR DA ÁREA) OPERA A FROTA E O EMBARQUE.' };
  return { evento };
}

async function veiculo(interaction) {
  const { evento, erro } = await carregarCaravana(interaction, interaction.options.getInteger('evento'));
  if (erro) return interaction.reply({ content: erro, flags: 64 });
  const v = await repo.adicionarVeiculo({
    eventoId: evento.id,
    nome: interaction.options.getString('nome'),
    capacidade: interaction.options.getInteger('capacidade'),
    responsavelId: interaction.options.getUser('responsavel')?.id ?? null,
    ponto: interaction.options.getString('ponto'),
    horario: interaction.options.getString('horario'),
  });
  await registrarLogGestao(interaction.client, {
    titulo: `🚌 VEÍCULO ADICIONADO — ${evento.titulo.toUpperCase()}`,
    ator: interaction.user.id,
    campos: [{ name: 'VEÍCULO', value: `${v.nome} (${v.capacidade} lugares)`, inline: true }],
  });
  return interaction.reply({ content: `🚌 VEÍCULO **${v.nome}** (${v.capacidade} LUGARES) ADICIONADO À CARAVANA #${evento.id}.`, flags: 64 });
}

async function alocar(interaction) {
  const { evento, erro } = await carregarCaravana(interaction, interaction.options.getInteger('evento'));
  if (erro) return interaction.reply({ content: erro, flags: 64 });
  const usuario = interaction.options.getUser('membro');
  const r = await repo.alocar(evento.id, usuario.id, interaction.options.getInteger('veiculo'));
  if (r.erro) return interaction.reply({ content: r.erro, flags: 64 });
  return interaction.reply({ content: `🦅 ${usuario} ALOCADO NO **${r.veiculo.nome}** (${r.lugar}/${r.veiculo.capacidade}).`, flags: 64, allowedMentions: { parse: [] } });
}

async function embarque(interaction) {
  const { evento, erro } = await carregarCaravana(interaction, interaction.options.getInteger('evento'));
  if (erro) return interaction.reply({ content: erro, flags: 64 });
  const trecho = interaction.options.getString('trecho');
  const select = new UserSelectMenuBuilder()
    .setCustomId(`car:embarque:${evento.id}:${trecho}`)
    .setPlaceholder(`QUEM EMBARCOU NA ${trecho}`)
    .setMinValues(1)
    .setMaxValues(25);
  return interaction.reply({
    content: `**🚌 EMBARQUE — ${trecho} — ${evento.titulo.toUpperCase()}**\nMarque quem subiu no ônibus (até 25 por vez).${trecho === 'IDA' ? ' O embarque da ida conta como presença no evento.' : ''}`,
    components: [new ActionRowBuilder().addComponents(select)],
    flags: 64,
  });
}

async function manifesto(interaction) {
  const { evento, erro } = await carregarCaravana(interaction, interaction.options.getInteger('evento'));
  if (erro) return interaction.reply({ content: erro, flags: 64 });
  await interaction.deferReply({ flags: 64 });
  const [veiculos, inscricoes, checkins] = await Promise.all([
    repo.listarVeiculos(evento.id),
    eventosRepo.listarInscricoesComVeiculo(evento.id),
    repo.listarCheckins(evento.id),
  ]);
  // Resultado financeiro só para quem vê o caixa
  const resultado = await podeVerFinanceiro(interaction.member)
    ? resumirLancamentos(await financeiroRepo.totaisPorCategoria({ eventoId: evento.id }))
    : null;
  return interaction.editReply({ embeds: [montarManifesto({ evento, veiculos, inscricoes, checkins, resultado })], allowedMentions: { parse: [] } });
}

// Seletor de embarque: car:embarque:<evento>:<IDA|VOLTA>
registrarModulo('car', async interaction => {
  const [, acao, eventoId, trecho] = interaction.customId.split(':');
  if (acao !== 'embarque' || !interaction.isUserSelectMenu() || !['IDA', 'VOLTA'].includes(trecho)) return;
  const { evento, erro } = await carregarCaravana(interaction, eventoId);
  if (erro) return interaction.update({ content: erro, components: [] });

  await interaction.deferUpdate();
  const novos = await repo.registrarEmbarque(evento.id, interaction.values, trecho, interaction.user.id);
  if (trecho === 'IDA' && novos.length) {
    // Só a ida materializa a presença: a volta é o mesmo comparecimento
    const presentes = await eventosRepo.marcarPresenca(evento.id, novos, interaction.user.id);
    await notificarPresenca({ evento, discordIds: presentes, client: interaction.client });
    await atualizarMensagemEvento(interaction.client, evento.id).catch(() => {});
  }
  return interaction.editReply({
    content: `🚌 ${novos.length} EMBARQUE${novos.length !== 1 ? 'S' : ''} NA ${trecho} REGISTRADO${novos.length !== 1 ? 'S' : ''}${interaction.values.length > novos.length ? ` (${interaction.values.length - novos.length} já registrado${interaction.values.length - novos.length !== 1 ? 's' : ''})` : ''}. Rode \`/caravana manifesto\` para conferir.`,
    components: [],
  });
});

const opcaoEvento = o => o.setName('evento').setDescription('Caravana').setRequired(true).setAutocomplete(true);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('caravana')
    .setDescription('Frota, alocação, embarque e manifesto das caravanas')
    .addSubcommand(s => s.setName('veiculo').setDescription('Adiciona um ônibus/van à caravana')
      .addIntegerOption(opcaoEvento)
      .addStringOption(o => o.setName('nome').setDescription('Identificação (ex.: Ônibus 1)').setRequired(true).setMaxLength(60))
      .addIntegerOption(o => o.setName('capacidade').setDescription('Lugares').setRequired(true).setMinValue(1).setMaxValue(100))
      .addUserOption(o => o.setName('responsavel').setDescription('Quem responde pelo veículo'))
      .addStringOption(o => o.setName('ponto').setDescription('Ponto de embarque').setMaxLength(100))
      .addStringOption(o => o.setName('horario').setDescription('Horário de saída').setMaxLength(30)))
    .addSubcommand(s => s.setName('alocar').setDescription('Coloca um confirmado num veículo')
      .addIntegerOption(opcaoEvento)
      .addUserOption(o => o.setName('membro').setDescription('Confirmado na caravana').setRequired(true))
      .addIntegerOption(o => o.setName('veiculo').setDescription('Veículo').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('embarque').setDescription('Registra quem embarcou na ida ou na volta')
      .addIntegerOption(opcaoEvento)
      .addStringOption(o => o.setName('trecho').setDescription('Trecho').setRequired(true)
        .addChoices({ name: 'Ida', value: 'IDA' }, { name: 'Volta', value: 'VOLTA' })))
    .addSubcommand(s => s.setName('manifesto').setDescription('Lista por veículo com embarque e pendências').addIntegerOption(opcaoEvento)),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'veiculo') return veiculo(interaction);
    if (sub === 'alocar') return alocar(interaction);
    if (sub === 'embarque') return embarque(interaction);
    return manifesto(interaction);
  },

  async autocomplete(interaction) {
    const focado = interaction.options.getFocused(true);
    const busca = String(focado.value ?? '').toLowerCase();
    if (focado.name === 'veiculo') {
      const eventoId = interaction.options.getInteger('evento');
      if (!eventoId) return interaction.respond([]);
      const veiculos = await repo.listarVeiculos(eventoId);
      return interaction.respond(veiculos.filter(v => v.nome.toLowerCase().includes(busca)).slice(0, 25)
        .map(v => ({ name: `${v.nome} (${v.capacidade} lugares)`.slice(0, 100), value: Number(v.id) })));
    }
    const eventos = (await eventosRepo.listarProximos(50)).filter(e => e.tipo === 'CARAVANA');
    return interaction.respond(eventos
      .filter(e => e.titulo.toLowerCase().includes(busca) || String(e.id).startsWith(busca))
      .slice(0, 25)
      .map(e => ({ name: `#${e.id} ${e.titulo}`.slice(0, 100), value: Number(e.id) })));
  },
};
