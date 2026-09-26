const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits: P } = require('discord.js');
const config = require('../../config/index.js');
const tema = require('../../tema');
const { lerConfig, gravarConfig } = require('../botConfig');
const { permissoesLideranca } = require('../logsJogo/painelCanal');
const { buscarDepartamento } = require('../departamentos/repositorio');
const { rotuloMotivo, nomeCanalCaso, nomeArquivoFoto } = require('./mantoRegras');

// Manto errado vira um "caso": um card (foto + motivo + quem recrutou/avaliou) num
// canal por motivo, só da liderança. Os canais nascem sob demanda, na categoria do
// provar-manto, e o ID fica em bot_config (`canal_manto_caso_<motivo>`).
// Ciclo do caso: ABERTO → RESOLVIDO (botão, liderança) ou REVISTO (manto reavaliado
// como correto / motivo trocado — o card antigo é fechado, nunca some sem rastro).

const chaveCanal = motivo => `canal_manto_caso_${motivo}`;
const criando = new Map(); // motivo → promessa (duas reprovações juntas não criam dois canais)

async function criarCanalCaso(guild, motivo) {
  const referencia = config.canais.provarManto
    ? await guild.channels.fetch(config.canais.provarManto).catch(() => null)
    : null;
  const permissoes = permissoesLideranca(guild, guild.members.me.id);
  // Gestor da área recrutamento também acompanha (mesmo critério de quem avalia)
  const gestor = (await buscarDepartamento('recrutamento').catch(() => null))?.cargo_gestor_id;
  if (gestor) permissoes.push({ id: gestor, allow: [P.ViewChannel, P.ReadMessageHistory] });
  const canal = await guild.channels.create({
    name: nomeCanalCaso(motivo),
    type: ChannelType.GuildText,
    parent: referencia?.parentId ?? null,
    permissionOverwrites: permissoes,
    reason: `Casos de manto reprovado: ${rotuloMotivo(motivo)}`,
  });
  await gravarConfig(chaveCanal(motivo), canal.id);
  return canal;
}

function garantirCanalCaso(guild, motivo) {
  if (!criando.has(motivo)) {
    const promessa = (async () => {
      const salvoId = await lerConfig(chaveCanal(motivo));
      const salvo = salvoId && await guild.channels.fetch(salvoId).catch(() => null);
      return salvo || criarCanalCaso(guild, motivo);
    })().finally(() => criando.delete(motivo));
    criando.set(motivo, promessa);
  }
  return criando.get(motivo);
}

const STATUS_FICHA = { APROVADO: 'aprovou', REPROVADO: 'reprovou' };
const quem = (id, status) => (id ? `<@${id}> (${STATUS_FICHA[status] ?? 'decidiu'})` : '*ficha ainda sem decisão*');

// estado: 'ABERTO' | 'RESOLVIDO' | 'REVISTO'
function embedCaso(caso, estado, { porId = null, imagem = null } = {}) {
  const aberto = estado === 'ABERTO';
  const status = {
    ABERTO: `${tema.emoji.pendente} **ABERTO** — aguardando tratativa`,
    RESOLVIDO: `${tema.emoji.ok} **RESOLVIDO** por <@${porId}> em <t:${Math.floor(Date.now() / 1000)}:f>`,
    REVISTO: `${tema.emoji.ok} **REVISTO** — ${porId ? `<@${porId}> reavaliou o manto` : 'manto reavaliado'} e o caso deixou de valer`,
  }[estado];
  const campos = [
    { name: 'CANDIDATO', value: `<@${caso.candidato_id}>${caso.nome ? ` — ${caso.nome}` : ''}${caso.id_fivem ? ` (ID ${caso.id_fivem})` : ''}`, inline: false },
    { name: 'RECRUTADOR DA FICHA', value: quem(caso.decidido_por_id, caso.ficha_status), inline: true },
    { name: 'RECRUTADOR CITADO NO FORMULÁRIO', value: caso.recrutador_citado || '*não informado*', inline: true },
    { name: 'AVALIADO POR', value: `<@${caso.avaliado_por_id}>`, inline: true },
    { name: 'MOTIVO', value: rotuloMotivo(caso.motivo), inline: true },
    { name: 'FOTO ORIGINAL', value: `[ir para a mensagem](https://discord.com/channels/${config.guildId}/${config.canais.provarManto}/${caso.message_id})`, inline: true },
    ...(caso.reincidencia ? [{ name: 'REINCIDÊNCIA', value: `${tema.emoji.aviso} **${caso.reincidencia} fotos reprovadas** deste candidato (possível fraude ou uso de IA)`, inline: false }] : []),
    { name: 'STATUS', value: status, inline: false },
  ];
  return {
    color: aberto ? tema.cor.perigo : tema.cor.neutro,
    title: tema.titulo('🧥 MANTO REPROVADO'),
    fields: campos,
    ...(imagem ? { image: { url: `attachment://${imagem.name}` } } : {}),
    timestamp: new Date().toISOString(),
  };
}

function botaoResolver(fotoId) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mantoaval:resolver:${fotoId}`).setLabel('MARCAR COMO RESOLVIDO').setEmoji(tema.emoji.ok).setStyle(ButtonStyle.Secondary),
  )];
}

// Publica o card no canal do motivo. Devolve { canalId, mensagemId }.
// `foto` = anexo da foto original ({ url, name }) ou null se a mensagem sumiu.
async function publicarCaso(guild, caso, foto) {
  const canal = await garantirCanalCaso(guild, caso.motivo);
  const imagem = foto ? { url: foto.url, name: nomeArquivoFoto(foto.name) } : null;
  const mensagem = await canal.send({
    embeds: [embedCaso(caso, 'ABERTO', { imagem })],
    components: botaoResolver(caso.message_id),
    ...(imagem ? { files: [{ attachment: imagem.url, name: imagem.name }] } : {}),
    allowedMentions: { parse: [] },
  });
  return { canalId: canal.id, mensagemId: mensagem.id };
}

// Fecha o card de um caso (resolvido ou revisto): tira o botão e troca o status.
// Nunca lança: o caso já mudou no banco, o card é acessório.
async function fecharCard(client, caso, estado, porId) {
  try {
    const canal = await client.channels.fetch(caso.caso_canal_id).catch(() => null);
    const mensagem = await canal?.messages.fetch(caso.caso_message_id).catch(() => null);
    if (!mensagem) return false;
    const campos = mensagem.embeds[0]?.fields ?? [];
    const status = embedCaso({ ...caso, avaliado_por_id: caso.avaliado_por_id }, estado, { porId }).fields.at(-1);
    await mensagem.edit({
      embeds: [EmbedBuilder.from(mensagem.embeds[0]).setColor(tema.cor.neutro).setFields(campos.map(c => (c.name === 'STATUS' ? status : c)))],
      components: [],
      allowedMentions: { parse: [] },
    });
    return true;
  } catch (err) {
    console.error('[manto] Erro ao fechar o card do caso:', err);
    return false;
  }
}

module.exports = { garantirCanalCaso, publicarCaso, fecharCard, embedCaso, botaoResolver };
