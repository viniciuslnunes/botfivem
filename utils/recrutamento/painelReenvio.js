const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, LabelBuilder, ModalBuilder,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const config = require('../../config/index.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const { registrarLogGestao } = require('../logGestao');
const { garantirMembrosCarregados } = require('../membrosGuild');
const { buscarBloqueio } = require('../naoRecrutar');
const { criarPainelCanal } = require('../logsJogo/painelCanal');
const F = require('../logsJogo/painelFormato');
const E = require('../logsJogo/estatisticas');
const fichas = require('./fichas');
const regras = require('./regras');
const tema = require('../../tema');

// Canal 🔓・reprovados-definitivos, logo abaixo do validar-setagem: todo
// candidato reprovado com "NÃO PODE TENTAR DE NOVO" e o botão pra liberar uma
// nova tentativa. O bloqueio vive na ficha (banco), não no cargo REPROVADO
// RECRUTAMENTO — quem sai e volta do servidor perde o cargo mas continua
// barrado, e até aqui não havia como desfazer isso.
//
// Fluxo da liberação: botão → select do candidato → modal com o motivo (ver
// padrão botão→select→modal). Permissão conferida em cada passo.
const SLUG = 'reprovados_definitivos';
const LIMITE_SELECT = 25;

let clientAtual = null;

// Cada reprovado é um bloco de 3 níveis: quem (negrito + ID), quando/por que/por
// quem (subtexto pequeno) e o motivo numa citação (barra lateral). Quem já saiu
// do servidor não ganha menção (vira <@id> cru, sem avatar): só a marca 🚪.
// O \n extra no fim, somado ao \n do join do embedsDeLista, é a linha em branco
// que separa um bloco do outro.
function linhaReprovado(r, membros) {
  const saiu = membros && !membros.has(r.discord_id);
  const quem = saiu ? '🚪 *saiu do servidor*' : `<@${r.discord_id}>`;
  const meta = [
    `📅 ${E.formatarDataHora(r.decidido_em ?? r.criado_em)}`,
    `**${regras.rotuloCategoria(r.reprovado_categoria)}**`,
    r.decidido_por_id ? `por <@${r.decidido_por_id}>` : null,
  ].filter(Boolean).join(' · ');
  const motivo = r.reprovado_motivo
    ? `\n> ${F.nomeSeguro(E.truncar(r.reprovado_motivo.replace(/\s+/g, ' '), 140))}`
    : '';
  return `${F.pessoa({ nome: r.nome, id: r.id_fivem })} · ${quem}\n-# ${meta}${motivo}\n`;
}

// Falha ao carregar membros não derruba a lista: só some a marca "fora do servidor"
async function membrosDoServidor(client) {
  try {
    const guild = await client.guilds.fetch(config.guildId);
    await garantirMembrosCarregados(guild);
    return guild.members.cache;
  } catch (err) {
    console.error(`[${SLUG}] Erro ao carregar membros:`, err);
    return null;
  }
}

async function montarBlocos(client) {
  const [reprovados, membros] = await Promise.all([fichas.listarReprovacoesDefinitivas(), membrosDoServidor(client)]);
  return F.blocosDeEmbeds(F.embedsDeLista({
    titulo: `🔓 REPROVADOS SEM NOVA TENTATIVA (${reprovados.length})`,
    cabecalho: 'Reprovados com **NÃO PODE TENTAR DE NOVO**. Enquanto estiverem aqui, o botão SOLICITAR RECRUTAMENTO '
      + 'recusa a pessoa — mesmo que ela saia e volte do servidor sem o cargo de reprovado.\n'
      + 'Para liberar uma nova tentativa, use o botão no **fim do canal**.',
    linhas: reprovados.map(r => linhaReprovado(r, membros)),
    vazio: 'Ninguém barrado de tentar de novo.',
    fonte: 'Fichas de recrutamento registradas pelo bot',
  }));
}

function montarAcao() {
  return {
    content: '👇 **PERMITIR QUE UM REPROVADO TENTE O RECRUTAMENTO DE NOVO**',
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('reenvio:listar').setLabel('PERMITIR TENTAR DE NOVO').setEmoji('🔓').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('reenvio:buscar').setLabel('BUSCAR POR ID FIVEM OU NOME').setEmoji('🔎').setStyle(ButtonStyle.Secondary),
    )],
  };
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '🔓・reprovados-definitivos',
  razao: 'Reprovados de forma definitiva no recrutamento e liberação de nova tentativa',
  intervaloMin: 30,
  debounceMs: 5 * 1000,
  canalVizinhoId: config.canais.validarSetagem,
  montarBlocos: () => montarBlocos(clientAtual),
  montarAcao,
});

function selectReprovados(reprovados) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('reenvio:escolher')
      .setPlaceholder('QUEM PODE TENTAR DE NOVO?')
      .addOptions(reprovados.slice(0, LIMITE_SELECT).map(regras.opcaoReprovado))
  );
}

// Resposta ephemeral com o select dos candidatos (lista inteira ou resultado da busca)
async function responderComSelect(interaction, reprovados, { vazio, total }) {
  if (!reprovados.length) return interaction.editReply({ content: vazio });
  const excedente = reprovados.length > LIMITE_SELECT
    ? `\n-# Mostrando os ${LIMITE_SELECT} mais recentes de ${reprovados.length}. Para achar outro, use **BUSCAR POR ID FIVEM OU NOME**.`
    : '';
  return interaction.editReply({
    content: `🔓 **ESCOLHA QUEM PODE TENTAR O RECRUTAMENTO DE NOVO** (${total ?? reprovados.length})${excedente}`,
    components: [selectReprovados(reprovados)],
  });
}

async function listar(interaction) {
  await interaction.deferReply({ flags: 64 });
  const reprovados = await fichas.listarReprovacoesDefinitivas();
  return responderComSelect(interaction, reprovados, { vazio: `${tema.emoji.ok} NINGUÉM ESTÁ BARRADO DE TENTAR DE NOVO.` });
}

function abrirBusca(interaction) {
  const modal = new ModalBuilder().setCustomId('reenvio:buscarmodal').setTitle('BUSCAR REPROVADO');
  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('ID FiveM ou nome')
      .setDescription('Só números busca pelo ID exato; texto busca por parte do nome')
      .setTextInputComponent(
        new TextInputBuilder().setCustomId('termo').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32)
      )
  );
  return interaction.showModal(modal);
}

async function buscar(interaction) {
  await interaction.deferReply({ flags: 64 });
  const termo = interaction.fields.getTextInputValue('termo');
  const encontrados = regras.filtrarReprovados(await fichas.listarReprovacoesDefinitivas(), termo);
  return responderComSelect(interaction, encontrados, {
    vazio: `🔎 NENHUM REPROVADO DEFINITIVO ENCONTRADO PARA **${F.nomeSeguro(termo)}**.`,
  });
}

function abrirConfirmacao(interaction) {
  const messageId = interaction.values[0];
  const rotulo = interaction.component?.options?.find(o => o.value === messageId)?.label ?? 'candidato';
  const modal = new ModalBuilder().setCustomId(`reenvio:confirmar:${messageId}`).setTitle('PERMITIR TENTAR DE NOVO');
  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Motivo da liberação')
      .setDescription(E.truncar(`${rotulo} — fica registrado no log de gestão`, 100))
      .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId('motivo')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(regras.MOTIVO_LIBERACAO_MIN)
          .setMaxLength(regras.MOTIVO_LIBERACAO_MAX)
      )
  );
  return interaction.showModal(modal);
}

// A ficha original no validar-setagem passa a dizer que foi liberada
async function marcarFichaOriginal(client, messageId, porId) {
  const canal = await client.channels.fetch(config.canais.validarSetagem).catch(() => null);
  const mensagem = canal ? await canal.messages.fetch(messageId).catch(() => null) : null;
  const embed = mensagem?.embeds[0];
  if (!embed) return;
  const valor = `SIM — LIBERADO POR <@${porId}> <t:${Math.floor(Date.now() / 1000)}:d>`;
  const campos = embed.fields.map(c => (c.name === 'PODE TENTAR DE NOVO' ? { ...c, value: valor } : c));
  await mensagem.edit({ embeds: [EmbedBuilder.from(embed).setFields(campos)], allowedMentions: { parse: [] } });
}

// 'removido' | 'sem_cargo' | 'fora' | 'falhou'
async function tirarCargoReprovado(guild, discordId) {
  const membro = await guild.members.fetch(discordId).catch(() => null);
  if (!membro) return 'fora';
  const cargo = config.cargos.reprovadoRecrutamento;
  if (!cargo || !membro.roles.cache.has(cargo)) return 'sem_cargo';
  return membro.roles.remove(cargo, 'Reprovação definitiva liberada').then(() => 'removido', () => 'falhou');
}

async function avisarCandidato(client, discordId) {
  try {
    const usuario = await client.users.fetch(discordId);
    await usuario.send({
      embeds: [{
        color: tema.cor.primaria,
        title: tema.titulo('🔓 RECRUTAMENTO'),
        description: 'Sua reprovação anterior foi revista. **Você já pode enviar uma nova solicitação de recrutamento.**',
      }],
    });
    return true;
  } catch {
    return false;
  }
}

async function confirmar(interaction, messageId) {
  await interaction.deferReply({ flags: 64 });
  const validacao = regras.validarMotivoLiberacao(interaction.fields.getTextInputValue('motivo'));
  if (!validacao.ok) return interaction.editReply({ content: validacao.mensagem });

  const ficha = await fichas.liberarReenvio(messageId, { porId: interaction.user.id, motivo: validacao.motivo });
  if (!ficha) {
    return interaction.editReply({ content: '⚠️ ESTE CANDIDATO JÁ FOI LIBERADO (OU A FICHA NÃO ESTÁ MAIS COMO REPROVAÇÃO DEFINITIVA).' });
  }

  const { client } = interaction;
  // A liberação já valeu no banco; o resto é acessório e cada falha é dita na resposta
  const [cargo, avisado, bloqueioId] = await Promise.all([
    tirarCargoReprovado(interaction.guild, ficha.discord_id),
    avisarCandidato(client, ficha.discord_id),
    ficha.id_fivem ? buscarBloqueio(client, ficha.id_fivem).catch(() => null) : null,
    marcarFichaOriginal(client, messageId, interaction.user.id)
      .catch(err => console.error(`[${SLUG}] Erro ao marcar ficha original:`, err)),
  ]);
  painel.atualizar(client).catch(err => console.error(`[${SLUG}] Erro ao atualizar após liberação:`, err));

  await registrarLogGestao(client, {
    titulo: '🔓 RECRUTAMENTO LIBERADO PARA NOVA TENTATIVA',
    ator: interaction.user.id,
    campos: [
      { name: 'CANDIDATO', value: `<@${ficha.discord_id}> — ${ficha.nome || '?'}`, inline: true },
      { name: 'ID FIVEM', value: ficha.id_fivem || '?', inline: true },
      { name: 'REPROVAÇÃO ORIGINAL', value: regras.rotuloCategoria(ficha.reprovado_categoria), inline: false },
      { name: 'MOTIVO DA LIBERAÇÃO', value: validacao.motivo, inline: false },
    ],
  });

  const avisos = {
    removido: '🏷️ Cargo de reprovado removido.',
    sem_cargo: '',
    fora: '🚪 Ele não está no servidor agora — ao voltar, já consegue pedir.',
    falhou: '⚠️ NÃO CONSEGUI REMOVER O CARGO DE REPROVADO — remova manualmente.',
  };
  const linhas = [
    `${tema.emoji.ok} ${F.pessoa({ nome: ficha.nome, id: ficha.id_fivem })} (<@${ficha.discord_id}>) **PODE SOLICITAR RECRUTAMENTO DE NOVO.**`,
    avisos[cargo],
    avisado ? '📩 Candidato avisado por DM.' : '⚠️ Não foi possível avisar por DM (DM fechada ou fora do servidor).',
    bloqueioId ? `⛔ Atenção: o ID FiveM **${ficha.id_fivem}** continua no ❌・nao-recrutar — a aprovação vai ser barrada até removê-lo de lá.` : '',
  ];
  return interaction.editReply({ content: linhas.filter(Boolean).join('\n'), allowedMentions: { parse: [] } });
}

registrarModulo('reenvio', async interaction => {
  const [, acao, alvo] = interaction.customId.split(':');
  if (!ehLideranca(interaction.member)) {
    return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
  }
  if (acao === 'listar' && interaction.isButton()) return listar(interaction);
  if (acao === 'buscar' && interaction.isButton()) return abrirBusca(interaction);
  if (acao === 'buscarmodal' && interaction.isModalSubmit()) return buscar(interaction);
  if (acao === 'escolher' && interaction.isStringSelectMenu()) return abrirConfirmacao(interaction);
  if (acao === 'confirmar' && interaction.isModalSubmit()) return confirmar(interaction, alvo);
});

function iniciarPainelReenvio(client) {
  clientAtual = client;
  painel.iniciar(client);
}

// Chamado quando sai uma reprovação definitiva nova
function agendarAtualizacaoReativa(client) {
  clientAtual = client;
  painel.agendarAtualizacaoReativa(client);
}

module.exports = { iniciarPainelReenvio, agendarAtualizacaoReativa };
