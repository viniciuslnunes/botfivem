const crypto = require('crypto');
const { SlashCommandBuilder } = require('discord.js');
const config = require('../config/index.js');
const { agendar } = require('../utils/agendador');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../utils/permissoes');
const { registrarLogGestao } = require('../utils/logGestao');
const { listarDepartamentos } = require('../utils/departamentos/repositorio');
const { PERIODO_CHOICES, resolverPeriodo } = require('../utils/logsJogo/estatisticas');
const { listaLimitada } = require('../utils/departamentos/regras');
const repo = require('../utils/eventos/repositorio');
const regras = require('../utils/eventos/regras');
const { publicarEvento, atualizarMensagemEvento, linkDaMensagem } = require('../utils/eventos/mensagem');
const { podeCriarEventos, podeGerirEvento } = require('../utils/eventos/permissoes');
const { avisarPorDM } = require('../utils/eventos/interacoes');
const tema = require('../tema');

const DIA_MS = 24 * 60 * 60 * 1000;
const unix = d => Math.floor(new Date(d).getTime() / 1000);

async function criar(interaction) {
  if (!(await podeCriarEventos(interaction.member))) {
    return interaction.reply({ content: '❌ SÓ A LIDERANÇA OU GESTORES DE ÁREA CRIAM EVENTOS.', flags: 64 });
  }
  const inicio = regras.parseDataHora(interaction.options.getString('data'));
  if (!inicio) return interaction.reply({ content: '❌ DATA INVÁLIDA. USE `DD/MM HH:MM` (EX.: `20/09 19:30`) OU `DD/MM/AAAA HH:MM`.', flags: 64 });
  if (inicio.getTime() <= Date.now()) return interaction.reply({ content: '❌ A DATA DO EVENTO JÁ PASSOU.', flags: 64 });
  if (!interaction.channel?.isTextBased()) return interaction.reply({ content: '❌ USE ESTE COMANDO NUM CANAL DE TEXTO.', flags: 64 });

  await interaction.deferReply({ flags: 64 });
  const semanas = interaction.options.getInteger('repetir_semanas') ?? 0;
  const datas = regras.datasDaSerie(inicio, semanas, config.eventos.maxSemanasSerie);
  const serieId = datas.length > 1 ? crypto.randomBytes(6).toString('hex') : null;
  const base = {
    tipo: interaction.options.getString('tipo') ?? 'GERAL',
    titulo: interaction.options.getString('titulo'),
    descricao: interaction.options.getString('descricao'),
    local: interaction.options.getString('local'),
    capacidade: interaction.options.getInteger('capacidade'),
    areaSlug: config.departamentos.some(d => d.slug === interaction.options.getString('area')) ? interaction.options.getString('area') : null,
    serieId,
    canalId: interaction.channelId,
    criadoPorId: interaction.user.id,
  };

  const criados = [];
  for (const data of datas) {
    const evento = await repo.criarEvento({ ...base, inicioEm: data });
    criados.push(evento);
    // Ocorrência distante de uma série só entra no canal perto da data
    const publicarEm = data.getTime() - config.eventos.publicarDiasAntes * DIA_MS;
    if (publicarEm <= Date.now()) await publicarEvento(interaction.client, evento);
    else await agendar('evento_publicar', new Date(publicarEm), { eventoId: evento.id });
    const lembreteEm = data.getTime() - config.eventos.lembreteMinutos * 60 * 1000;
    if (lembreteEm > Date.now()) await agendar('evento_lembrete', new Date(lembreteEm), { eventoId: evento.id });
    await agendar('evento_iniciar', data, { eventoId: evento.id });
    await agendar('evento_memoria', new Date(data.getTime() + config.memoria.resumoEventoHoras * 3600000), { eventoId: evento.id });
  }

  const primeiro = criados[0];
  await registrarLogGestao(interaction.client, {
    titulo: `📅 EVENTO CRIADO — ${primeiro.titulo.toUpperCase()}`,
    ator: interaction.user.id,
    campos: [
      { name: 'EVENTO', value: `#${primeiro.id}${criados.length > 1 ? ` (+${criados.length - 1} na série)` : ''}`, inline: true },
      { name: 'QUANDO', value: `<t:${unix(primeiro.inicio_em)}:F>`, inline: true },
    ],
  });
  return interaction.editReply({
    content: criados.length > 1
      ? `🦅 SÉRIE CRIADA: ${criados.length} ocorrências semanais (#${criados.map(e => e.id).join(', #')}). Cada uma aparece no canal ${config.eventos.publicarDiasAntes} dias antes.`
      : `🦅 EVENTO #${primeiro.id} CRIADO.`,
  });
}

async function lista(interaction) {
  await interaction.deferReply({ flags: 64 });
  const proximos = (await repo.listarProximos(15)).filter(e => new Date(e.inicio_em).getTime() > Date.now());
  const linhas = proximos.map(e => {
    const tipo = regras.TIPOS_EVENTO[e.tipo] ?? regras.TIPOS_EVENTO.GERAL;
    const link = linkDaMensagem(e);
    return `${tipo.emoji} **#${e.id} ${link ? `[${e.titulo}](${link})` : e.titulo}** · <t:${unix(e.inicio_em)}:f> (<t:${unix(e.inicio_em)}:R>)`;
  });
  return interaction.editReply({
    embeds: [{ color: tema.cor.primaria, title: '📅 PRÓXIMOS EVENTOS', description: linhas.join('\n') || '*Nenhum evento agendado.*' }],
  });
}

async function cancelar(interaction) {
  const evento = await repo.buscarEvento(interaction.options.getInteger('id'));
  if (!evento || evento.status !== 'ATIVO') return interaction.reply({ content: '❌ EVENTO NÃO ENCONTRADO OU JÁ CANCELADO.', flags: 64 });
  if (!(await podeGerirEvento(interaction.member, evento))) {
    return interaction.reply({ content: '❌ SÓ QUEM ORGANIZA ESTE EVENTO PODE CANCELÁ-LO.', flags: 64 });
  }
  await interaction.deferReply({ flags: 64 });
  const cancelados = await repo.cancelarEventos(evento, interaction.options.getString('escopo') ?? 'este');
  const motivo = interaction.options.getString('motivo');

  for (const e of cancelados) {
    await atualizarMensagemEvento(interaction.client, e.id).catch(() => {});
    const inscritos = (await repo.listarInscricoes(e.id)).filter(i => i.status === 'CONFIRMADO' || i.status === 'ESPERA');
    for (const inscrito of inscritos) {
      await avisarPorDM(interaction.client, inscrito.discord_id, {
        content: `❌ O evento **${e.titulo}** de <t:${unix(e.inicio_em)}:f> foi cancelado.${motivo ? ` Motivo: ${motivo}` : ''}`,
      });
    }
  }
  await registrarLogGestao(interaction.client, {
    titulo: `❌ EVENTO CANCELADO — ${evento.titulo.toUpperCase()}`,
    ator: interaction.user.id,
    cor: tema.cor.perigo,
    campos: [
      { name: 'EVENTOS', value: cancelados.map(e => `#${e.id}`).join(', ') || '—', inline: true },
      { name: 'MOTIVO', value: motivo || 'Não informado', inline: true },
    ],
  });
  return interaction.editReply({ content: `❌ ${cancelados.length} EVENTO${cancelados.length !== 1 ? 'S' : ''} CANCELADO${cancelados.length !== 1 ? 'S' : ''}. OS INSCRITOS FORAM AVISADOS POR DM.` });
}

async function relatorio(interaction) {
  if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
  await interaction.deferReply({ flags: 64 });
  const periodo = resolverPeriodo(interaction.options.getString('periodo') ?? '30d');
  const [eventos, presentes] = await Promise.all([
    repo.eventosDoPeriodo(periodo.inicio, periodo.fim),
    repo.maisPresentes(periodo.inicio, periodo.fim, 10),
  ]);
  const totalConfirmados = eventos.reduce((s, e) => s + e.confirmados, 0);
  const totalPresentes = eventos.reduce((s, e) => s + e.presentes, 0);
  const totalNoShow = eventos.reduce((s, e) => s + e.no_show, 0);
  const linhas = eventos.slice(0, 15).map(e =>
    `**#${e.id} ${e.titulo}** · <t:${unix(e.inicio_em)}:d> · ${e.presentes}/${e.confirmados} · ${regras.formatarTaxa(e.confirmados ? e.presentes / e.confirmados : null)}`);

  return interaction.editReply({
    embeds: [{
      color: tema.cor.primaria,
      title: `📋 COMPARECIMENTO — ${periodo.rotulo}`,
      description: linhas.join('\n') || '*Nenhum evento realizado no período.*',
      fields: [
        { name: 'EVENTOS', value: String(eventos.length), inline: true },
        { name: 'TAXA DE PRESENÇA', value: regras.formatarTaxa(totalConfirmados ? totalPresentes / totalConfirmados : null), inline: true },
        { name: 'CONFIRMARAM E NÃO VIERAM', value: String(totalNoShow), inline: true },
        { name: 'MAIS PRESENTES', value: listaLimitada(presentes.map(p => `<@${p.discord_id}> — ${p.presencas}`), 1000) || '*Sem presenças registradas.*', inline: false },
      ],
      footer: { text: 'Taxa = presentes ÷ confirmados. Quem veio sem confirmar conta como presente.' },
    }],
    allowedMentions: { parse: [] },
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('evento')
    .setDescription('Agenda da torcida: eventos, caravanas e ensaios')
    .addSubcommand(s => s.setName('criar').setDescription('Cria um evento neste canal (liderança ou gestor de área)')
      .addStringOption(o => o.setName('titulo').setDescription('Título').setRequired(true).setMaxLength(100))
      .addStringOption(o => o.setName('data').setDescription('Data e hora: DD/MM HH:MM').setRequired(true))
      .addStringOption(o => o.setName('tipo').setDescription('Padrão: evento').addChoices(...regras.TIPO_CHOICES))
      .addStringOption(o => o.setName('local').setDescription('Local').setMaxLength(100))
      .addIntegerOption(o => o.setName('capacidade').setDescription('Vagas (vazio = sem limite)').setMinValue(1).setMaxValue(1000))
      .addStringOption(o => o.setName('area').setDescription('Área que organiza').setAutocomplete(true))
      .addIntegerOption(o => o.setName('repetir_semanas').setDescription('Repetir toda semana por N semanas (ensaios)').setMinValue(1).setMaxValue(12))
      .addStringOption(o => o.setName('descricao').setDescription('Descrição').setMaxLength(1000)))
    .addSubcommand(s => s.setName('lista').setDescription('Próximos eventos'))
    .addSubcommand(s => s.setName('cancelar').setDescription('Cancela um evento e avisa os inscritos')
      .addIntegerOption(o => o.setName('id').setDescription('Evento').setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName('escopo').setDescription('Padrão: só este')
        .addChoices({ name: 'Só este', value: 'este' }, { name: 'Este e os próximos da série', value: 'serie' }))
      .addStringOption(o => o.setName('motivo').setDescription('Vai para os inscritos').setMaxLength(300)))
    .addSubcommand(s => s.setName('relatorio').setDescription('Comparecimento nos eventos (liderança)')
      .addStringOption(o => o.setName('periodo').setDescription('Padrão: últimos 30 dias').addChoices(...PERIODO_CHOICES))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'criar') return criar(interaction);
    if (sub === 'lista') return lista(interaction);
    if (sub === 'cancelar') return cancelar(interaction);
    return relatorio(interaction);
  },

  async autocomplete(interaction) {
    const focado = interaction.options.getFocused(true);
    const busca = String(focado.value ?? '').toLowerCase();
    if (focado.name === 'area') {
      const areas = await listarDepartamentos();
      return interaction.respond(areas.filter(a => a.nome.toLowerCase().includes(busca)).slice(0, 25)
        .map(a => ({ name: `${a.emoji} ${a.nome}`, value: a.slug })));
    }
    if (focado.name === 'id') {
      const eventos = await repo.listarProximos(25);
      return interaction.respond(eventos
        .filter(e => e.titulo.toLowerCase().includes(busca) || String(e.id).startsWith(busca))
        .map(e => ({ name: `#${e.id} ${e.titulo}`.slice(0, 100), value: Number(e.id) })));
    }
    return interaction.respond([]);
  },
};
