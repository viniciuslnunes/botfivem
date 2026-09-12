const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config/index.js');
const { lerConfig } = require('../utils/botConfig');
const { CHAVE_CANAL_LOGS_GESTAO } = require('../utils/logGestao');
const { arquivarAnexo } = require('../utils/arquivoMidia');
const { buscarDepartamento } = require('../utils/departamentos/repositorio');
const eventosRepo = require('../utils/eventos/repositorio');
const regras = require('../utils/memoria/regras');
const repo = require('../utils/memoria/repositorio');
const { montarEstruturaMemoria, publicarFato, obterTopicoDoDia } = require('../utils/memoria/publicacao');
const { montarCartaoAprovacao } = require('../utils/memoria/interacoes');

// Fato atrasado vai para o canal da Comunicação (ou para o log de gestão, se a área não existir)
async function canalDeModeracao(client) {
  const comunicacao = await buscarDepartamento('comunicacao');
  for (const id of [comunicacao?.canal_id, await lerConfig(CHAVE_CANAL_LOGS_GESTAO)]) {
    const canal = id ? await client.channels.fetch(id).catch(() => null) : null;
    if (canal?.isTextBased()) return canal;
  }
  return null;
}

async function registrar(interaction) {
  if (!interaction.member.roles.cache.has(config.cargos.socio)) {
    return interaction.reply({ content: '❌ SÓ SÓCIOS REGISTRAM NA MEMÓRIA DA TORCIDA.', flags: 64 });
  }
  const dia = regras.parseDiaMemoria(interaction.options.getString('data'));
  const validacao = regras.validarDiaMemoria(dia, new Date(), config.memoria);
  if (!validacao.ok) return interaction.reply({ content: validacao.mensagem, flags: 64 });

  await interaction.deferReply({ flags: 64 });
  let midiaRef = null;
  const foto = interaction.options.getAttachment('foto');
  if (foto) {
    try {
      midiaRef = (await arquivarAnexo(interaction.client, foto, `📜 Memória ${regras.formatarDia(dia)} — ${interaction.user.tag}`)).ref;
    } catch (err) {
      return interaction.editReply({ content: `❌ ${String(err.message).toUpperCase()}` });
    }
  }

  const status = regras.statusInicialDoFato(dia);
  const fato = await repo.criarFato({
    dia,
    autorId: interaction.user.id,
    texto: interaction.options.getString('texto'),
    midiaRef,
    eventoId: interaction.options.getInteger('evento'),
    status,
  });

  if (status === 'APROVADA') {
    const mensagem = await publicarFato(interaction.client, { ...fato, dia_chave: dia });
    return interaction.editReply({ content: `📜 REGISTRADO NA MEMÓRIA DE ${regras.formatarDia(dia)}: ${mensagem.url}` });
  }

  const canal = await canalDeModeracao(interaction.client);
  if (canal) await canal.send(montarCartaoAprovacao({ ...fato, dia_chave: dia }));
  return interaction.editReply({ content: `⏳ ${regras.formatarDia(dia)} JÁ PASSOU: A MEMÓRIA VAI PARA APROVAÇÃO E VOCÊ É AVISADO POR DM QUANDO FOR DECIDIDA.` });
}

async function dia(interaction) {
  const chave = regras.parseDiaMemoria(interaction.options.getString('data'));
  if (!chave) return interaction.reply({ content: '❌ DATA INVÁLIDA. USE `DD/MM/AAAA`, `DD/MM` OU `hoje`.', flags: 64 });
  await interaction.deferReply({ flags: 64 });
  const threadId = await repo.threadDoDia(chave);
  const fatos = await repo.fatosDoDia(chave);
  if (!threadId) return interaction.editReply({ content: `📜 NADA REGISTRADO EM ${regras.formatarDia(chave)} AINDA. USE \`/memoria registrar\`.` });
  return interaction.editReply({ content: `📜 MEMÓRIA DE ${regras.formatarDia(chave)}: <#${threadId}> · ${fatos.length} registro${fatos.length !== 1 ? 's' : ''} de sócios.` });
}

async function setup(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ APENAS ADMINISTRADORES CRIAM O FÓRUM DA MEMÓRIA.', flags: 64 });
  }
  await interaction.deferReply({ flags: 64 });
  const r = await montarEstruturaMemoria(interaction.guild);
  return interaction.editReply({ content: r.criado ? `📜 FÓRUM DA MEMÓRIA CRIADO: <#${r.canalId}>` : `📜 O FÓRUM DA MEMÓRIA JÁ EXISTE: <#${r.canalId}>` });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('memoria')
    .setDescription('Linha do tempo da torcida')
    .addSubcommand(s => s.setName('registrar').setDescription('Registra um fato marcante num dia (dia que já passou vai para aprovação)')
      .addStringOption(o => o.setName('data').setDescription('DD/MM/AAAA, DD/MM ou hoje').setRequired(true))
      .addStringOption(o => o.setName('texto').setDescription('O que aconteceu').setRequired(true).setMaxLength(1500))
      .addAttachmentOption(o => o.setName('foto').setDescription('Foto do dia'))
      .addIntegerOption(o => o.setName('evento').setDescription('Evento relacionado').setAutocomplete(true)))
    .addSubcommand(s => s.setName('dia').setDescription('Abre a memória de um dia')
      .addStringOption(o => o.setName('data').setDescription('DD/MM/AAAA, DD/MM ou hoje').setRequired(true)))
    .addSubcommand(s => s.setName('setup').setDescription('Cria o fórum da memória (administrador)')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'registrar') return registrar(interaction);
    if (sub === 'dia') return dia(interaction);
    return setup(interaction);
  },

  async autocomplete(interaction) {
    const busca = String(interaction.options.getFocused() ?? '').toLowerCase();
    const eventos = await eventosRepo.listarProximos(25);
    return interaction.respond(eventos.filter(e => e.titulo.toLowerCase().includes(busca))
      .map(e => ({ name: `#${e.id} ${e.titulo}`.slice(0, 100), value: Number(e.id) })));
  },
};

// Usado pela tarefa de resumo de evento
module.exports.obterTopicoDoDia = obterTopicoDoDia;
