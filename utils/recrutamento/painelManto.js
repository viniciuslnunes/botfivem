const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../config/index.js');
const tema = require('../../tema');
const { registrarModulo } = require('../modulos');
const { ehLideranca } = require('../permissoes');
const { papelNaArea } = require('../departamentos/acesso');
const { garantirMembrosCarregados } = require('../membrosGuild');
const { criarPainelCanal } = require('../logsJogo/painelCanal');
const F = require('../logsJogo/painelFormato');
const { agendar, registrarTipo } = require('../agendador');
const repo = require('./mantoRepositorio');
const { RESULTADOS, montarPlacar } = require('./mantoRegras');

// Foto de manto no canal provar-manto → o bot responde com dois botões
// (correto/errado) e a liderança avalia. O placar por recrutador mora num
// canal-painel só da liderança (🧥・placar-manto). Sem verde em lugar nenhum:
// os dois botões são neutros, o resultado vai por emoji do tema.
const SLUG = 'placar_manto';
const MSG_SEM_PERMISSAO = '❌ APENAS A LIDERANÇA (PRESIDÊNCIA, VELHA GUARDA, DIRETORIA) OU O RESPONSÁVEL PELO RECRUTAMENTO PODE AVALIAR O MANTO.';

// Manto errado: os botões ficam 10 min depois da avaliação (pra corrigir clique
// errado) e então somem. O agendador é persistente: sobrevive a reinício.
const PRAZO_BOTOES_ERRADO_MS = 10 * 60 * 1000;

let clientAtual = null;

async function podeAvaliar(member) {
  return ehLideranca(member) || (await papelNaArea(member, 'recrutamento')) === 'gestor';
}

function ehImagem(anexo) {
  return Boolean(anexo.contentType?.startsWith('image/'));
}

function botoesAvaliacao(messageId) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mantoaval:certo:${messageId}`).setLabel('MANTO CORRETO').setEmoji(tema.emoji.ok).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mantoaval:errado:${messageId}`).setLabel('MANTO ERRADO').setEmoji(tema.emoji.recusado).setStyle(ButtonStyle.Danger),
  )];
}

// Hook de mensagem (módulo recrutamento). Nunca consome a mensagem.
async function aoMensagem(message) {
  if (message.author?.bot || message.channelId !== config.canais.provarManto) return false;
  if (![...message.attachments.values()].some(ehImagem)) return false;
  try {
    await repo.registrarFoto({ messageId: message.id, candidatoId: message.author.id, enviadoEm: message.createdAt });
    await message.reply({
      content: '🧥 **Avaliação do manto** — liderança ou responsável pelo recrutamento: a foto está correta?',
      components: botoesAvaliacao(message.id),
      allowedMentions: { parse: [] },
    });
    painel.agendarAtualizacaoReativa(clientAtual ?? message.client);
  } catch (err) {
    console.error('[manto] Erro ao registrar foto do manto:', err);
  }
  return false;
}

async function avaliar(interaction, acao, fotoId) {
  if (!(await podeAvaliar(interaction.member))) {
    return interaction.reply({ content: MSG_SEM_PERMISSAO, flags: 64 });
  }
  const resultado = RESULTADOS[acao];
  if (!resultado) return null;
  const foto = await repo.avaliarFoto(fotoId, { resultado, porId: interaction.user.id });
  if (!foto) {
    return interaction.reply({ content: '⚠️ ESTA FOTO NÃO ESTÁ REGISTRADA PARA AVALIAÇÃO (ENVIADA ANTES DO RECURSO EXISTIR).', flags: 64 });
  }
  const avaliadoEm = Math.floor(Date.now() / 1000);
  const rotulo = resultado === 'CORRETO' ? `${tema.emoji.ok} **MANTO CORRETO**` : `${tema.emoji.recusado} **MANTO ERRADO**`;
  // Manto validado: botões somem. Manto errado: ficam, pra liderança corrigir
  // um clique errado (vale o último).
  await interaction.update({
    content: `🧥 ${rotulo} — avaliado por <@${interaction.user.id}> em <t:${avaliadoEm}:f>`,
    components: resultado === 'CORRETO' ? [] : botoesAvaliacao(fotoId),
    allowedMentions: { parse: [] },
  });
  if (resultado !== 'CORRETO') {
    await agendar('manto_remover_botoes', new Date(Date.now() + PRAZO_BOTOES_ERRADO_MS), {
      canalId: interaction.channelId, mensagemId: interaction.message.id, avaliadoEm,
    }).catch(err => console.error('[manto] Erro ao agendar remoção dos botões:', err));
  }
  painel.agendarAtualizacaoReativa(interaction.client);
  return null;
}

// Só tira os botões se a mensagem ainda mostra esta avaliação (uma reavaliação
// posterior tem outro horário e agenda o próprio prazo).
registrarTipo('manto_remover_botoes', async (client, p) => {
  const canal = await client.channels.fetch(p.canalId).catch(() => null);
  const mensagem = await canal?.messages.fetch(p.mensagemId).catch(() => null);
  if (!mensagem || !mensagem.components.length) return;
  if (!mensagem.content.includes(`<t:${p.avaliadoEm}:f>`)) return;
  await mensagem.edit({ components: [], allowedMentions: { parse: [] } });
});

registrarModulo('mantoaval', async interaction => {
  const [, acao, fotoId] = interaction.customId.split(':');
  return avaliar(interaction, acao, fotoId);
});

async function idsRecrutadores(client) {
  try {
    const guild = await client.guilds.fetch(config.guildId);
    await garantirMembrosCarregados(guild);
    return guild.members.cache.filter(m => m.roles.cache.has(config.cargos.recrutador)).map(m => m.id);
  } catch (err) {
    console.error(`[${SLUG}] Erro ao carregar recrutadores:`, err);
    return [];
  }
}

function linhaRecrutador(r) {
  const total = r.acertos + r.erros;
  const taxa = r.taxa === null ? '—' : `${r.taxa}%`;
  return `• <@${r.id}> — ${tema.emoji.ok} **${r.acertos}** acertos · ${tema.emoji.recusado} **${r.erros}** erros · ${total} avaliados · ${taxa}`;
}

async function montarBlocos() {
  const [linhas, ids, pendentes] = await Promise.all([
    repo.placarPorRecrutador(), idsRecrutadores(clientAtual), repo.contarPendentes(),
  ]);
  const { recrutadores, semRecrutador } = montarPlacar(linhas, ids);
  const linhasTexto = recrutadores.map(linhaRecrutador);
  if (semRecrutador.acertos + semRecrutador.erros > 0) {
    linhasTexto.push(`\n*Sem recrutador (ficha ainda não decidida):* ${tema.emoji.ok} ${semRecrutador.acertos} · ${tema.emoji.recusado} ${semRecrutador.erros}`);
  }
  return F.blocosDeEmbeds(F.embedsDeLista({
    titulo: '🧥 PLACAR DE MANTO POR RECRUTADOR',
    cabecalho: 'Acertos e erros das fotos de manto enviadas no provar-manto, avaliadas pela liderança. '
      + 'A foto conta para o recrutador que **aprovou/decidiu a ficha** do candidato.\n'
      + `Fotos aguardando avaliação: **${pendentes}**`,
    linhas: linhasTexto,
    vazio: 'Nenhum recrutador encontrado.',
    fonte: 'Avaliações feitas nos botões do canal provar-manto',
  }));
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '🧥・placar-manto',
  razao: 'Placar de acertos e erros de manto por recrutador',
  intervaloMin: 60,
  debounceMs: 5 * 1000,
  canalVizinhoId: config.canais.provarManto,
  montarBlocos,
});

function iniciarPainelManto(client) {
  clientAtual = client;
  painel.iniciar(client);
}

module.exports = { iniciarPainelManto, aoMensagem, botoesAvaliacao };
