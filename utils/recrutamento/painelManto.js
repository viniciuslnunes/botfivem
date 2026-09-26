const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
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
const { RESULTADOS, montarPlacar, MOTIVOS_MANTO, motivoValido, rotuloMotivo, LIMITES, resumirFotos } = require('./mantoRegras');
const { buscarDepartamento } = require('../departamentos/repositorio');
const E = require('../logsJogo/estatisticas');
const casos = require('./mantoCasos');
const { textoRegrasManto } = require('./regrasManto');

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
const emProcessamento = new Set();

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
  // Trava em memória contra o mesmo evento chegando duas vezes; o banco
  // (registrarFoto) cobre reedição e outra instância.
  if (emProcessamento.has(message.id)) return false;
  emProcessamento.add(message.id);
  try {
    const novo = await repo.registrarFoto({ messageId: message.id, candidatoId: message.author.id, enviadoEm: message.createdAt });
    if (!novo) return false;
    try {
      const aviso = await message.reply({
        content: '🧥 **Avaliação do manto** — liderança ou responsável pelo recrutamento: a foto está correta?',
        components: botoesAvaliacao(message.id),
        allowedMentions: { parse: [] },
      });
      await agendarFotoParada(message.id, message.channelId, aviso.id, 0);
    } catch (err) {
      await repo.desfazerRegistro(message.id).catch(() => {});
      throw err;
    }
    painel.agendarAtualizacaoReativa(clientAtual ?? message.client);
  } catch (err) {
    console.error('[manto] Erro ao registrar foto do manto:', err);
  } finally {
    emProcessamento.delete(message.id);
  }
  return false;
}

// ── Lembretes agendados (sobrevivem a reinício) ──────────────────────────────

const MIN_MS = 60 * 1000;

// Foto sem avaliação: lembra a liderança em 30 min e de novo em 2 h (etapa 0 → 1 → fim)
async function agendarFotoParada(fotoId, canalId, avisoId, etapa) {
  const marcos = LIMITES.fotoParadaMin;
  if (etapa >= marcos.length) return;
  const espera = (marcos[etapa] - (etapa ? marcos[etapa - 1] : 0)) * MIN_MS;
  await agendar('manto_foto_parada', new Date(Date.now() + espera), { fotoId, canalId, avisoId, etapa })
    .catch(err => console.error('[manto] Erro ao agendar lembrete de foto parada:', err));
}

async function lembrarFotoParada(client, p) {
  const ctx = await repo.contextoDaFoto(p.fotoId);
  if (!ctx || ctx.resultado) return; // já avaliada
  const canal = await client.channels.fetch(p.canalId).catch(() => null);
  const gestor = (await buscarDepartamento('recrutamento').catch(() => null))?.cargo_gestor_id;
  const minutos = LIMITES.fotoParadaMin[p.etapa];
  await canal?.send({
    content: `⏰ ${gestor ? `<@&${gestor}> ` : ''}Foto de <@${ctx.candidato_id}> **aguardando avaliação há ${minutos >= 60 ? `${minutos / 60} h` : `${minutos} min`}**.`,
    reply: { messageReference: p.avisoId, failIfNotExists: false },
    allowedMentions: { roles: gestor ? [gestor] : [], users: [] },
  });
  await agendarFotoParada(p.fotoId, p.canalId, p.avisoId, p.etapa + 1);
}
registrarTipo('manto_foto_parada', lembrarFotoParada);

// Caso aberto além do prazo: lembra quem avaliou, até N vezes, enquanto não for resolvido
async function agendarPrazoCaso(fotoId, casoMessageId, lembrete) {
  if (lembrete >= LIMITES.lembretesCaso) return;
  await agendar('manto_caso_prazo', new Date(Date.now() + LIMITES.prazoCasoHoras * 60 * MIN_MS), { fotoId, casoMessageId, lembrete })
    .catch(err => console.error('[manto] Erro ao agendar prazo do caso:', err));
}

async function lembrarPrazoCaso(client, p) {
  const ctx = await repo.contextoDaFoto(p.fotoId);
  // Só lembra se o caso ainda é este, segue ERRADO e não foi resolvido
  if (!ctx || ctx.resultado !== 'ERRADO' || ctx.caso_message_id !== p.casoMessageId || ctx.caso_resolvido_em) return;
  const canal = await client.channels.fetch(ctx.caso_canal_id).catch(() => null);
  const horas = LIMITES.prazoCasoHoras * (p.lembrete + 1);
  await canal?.send({
    content: `⏰ <@${ctx.avaliado_por_id}> o caso do manto de <@${ctx.candidato_id}> está **aberto há ${horas} h**. Trate e marque como resolvido.`,
    reply: { messageReference: p.casoMessageId, failIfNotExists: false },
    allowedMentions: { users: [ctx.avaliado_por_id] },
  });
  await agendarPrazoCaso(p.fotoId, p.casoMessageId, p.lembrete + 1);
}
registrarTipo('manto_caso_prazo', lembrarPrazoCaso);

const semPermissao = interaction => interaction.reply({ content: MSG_SEM_PERMISSAO, flags: 64 });
const MSG_SEM_FOTO = '⚠️ ESTA FOTO NÃO ESTÁ REGISTRADA PARA AVALIAÇÃO (ENVIADA ANTES DO RECURSO EXISTIR).';

// Caso anterior (manto já reprovado antes) deixa de valer quando a avaliação muda
async function fecharCasoAnterior(client, anterior, porId) {
  if (anterior?.caso_message_id && !anterior.caso_resolvido_em) await casos.fecharCard(client, anterior, 'REVISTO', porId);
}

// CORRETO: grava direto e tira os botões
async function avaliarCerto(interaction, fotoId) {
  if (!(await podeAvaliar(interaction.member))) return semPermissao(interaction);
  const foto = await repo.avaliarFoto(fotoId, { resultado: RESULTADOS.certo, porId: interaction.user.id });
  if (!foto) return interaction.reply({ content: MSG_SEM_FOTO, flags: 64 });
  await interaction.update({
    content: `🧥 ${tema.emoji.ok} **MANTO CORRETO** — avaliado por <@${interaction.user.id}> em <t:${Math.floor(Date.now() / 1000)}:f>`,
    components: [],
    allowedMentions: { parse: [] },
  });
  await fecharCasoAnterior(interaction.client, foto.anterior, interaction.user.id);
  painel.agendarAtualizacaoReativa(interaction.client);
  return null;
}

// ERRADO, passo 1: ainda NÃO grava — abre o select de motivos (ephemeral). O erro
// só existe (e só conta contra o recrutador) depois do motivo escolhido.
async function pedirMotivo(interaction, fotoId) {
  if (!(await podeAvaliar(interaction.member))) return semPermissao(interaction);
  const ctx = await repo.contextoDaFoto(fotoId);
  if (!ctx) return interaction.reply({ content: MSG_SEM_FOTO, flags: 64 });
  return interaction.reply({
    content: '🧥 **POR QUE O MANTO ESTÁ ERRADO?** Escolha o motivo — o caso vai para o canal desse motivo.',
    components: [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`mantoaval:motivo:${fotoId}:${interaction.message.id}`)
        .setPlaceholder('MOTIVO DA REPROVAÇÃO')
        .addOptions(MOTIVOS_MANTO.map(m => ({ label: m.label, value: m.id })))
    )],
    flags: 64,
  });
}

// Candidato fica sabendo o porquê e como refazer (DM pode estar fechada: só informa)
async function avisarCandidato(client, candidatoId, motivo) {
  try {
    const usuario = await client.users.fetch(candidatoId);
    await usuario.send({
      embeds: [{
        color: tema.cor.perigo,
        title: tema.titulo('🧥 MANTO REPROVADO'),
        description: `Seu manto não foi aprovado: **${rotuloMotivo(motivo)}**.\n\n${textoRegrasManto()}\n\nFale com o seu recrutador para tentar de novo.`,
      }],
    });
    return true;
  } catch {
    return false;
  }
}

// Foto original (só o anexo, pra re-enviar no card); null se a mensagem sumiu
async function anexoDaFoto(interaction, fotoId) {
  const msg = await interaction.channel?.messages?.fetch(fotoId).catch(() => null);
  const anexo = msg ? [...msg.attachments.values()].find(ehImagem) : null;
  return anexo ? { url: anexo.url, name: anexo.name } : null;
}

// ERRADO, passo 2: motivo escolhido → grava, atualiza o aviso e abre o caso
async function registrarErrado(interaction, fotoId, avisoId) {
  if (!(await podeAvaliar(interaction.member))) return semPermissao(interaction);
  const motivo = interaction.values?.[0];
  if (!motivoValido(motivo)) return interaction.update({ content: '❌ MOTIVO INVÁLIDO. CLIQUE EM MANTO ERRADO E ESCOLHA DE NOVO.', components: [] });

  const foto = await repo.avaliarFoto(fotoId, { resultado: RESULTADOS.errado, porId: interaction.user.id, motivo });
  if (!foto) return interaction.update({ content: MSG_SEM_FOTO, components: [] });

  const avaliadoEm = Math.floor(Date.now() / 1000);
  // Aviso na foto: botões ficam 10 min (corrigir clique errado) e então somem
  const aviso = await interaction.channel?.messages?.fetch(avisoId).catch(() => null);
  await aviso?.edit({
    content: `🧥 ${tema.emoji.recusado} **MANTO ERRADO** (${rotuloMotivo(motivo)}) — avaliado por <@${interaction.user.id}> em <t:${avaliadoEm}:f>`,
    components: botoesAvaliacao(fotoId),
    allowedMentions: { parse: [] },
  }).catch(err => console.error('[manto] Erro ao atualizar o aviso da foto:', err));
  if (aviso) {
    await agendar('manto_remover_botoes', new Date(Date.now() + PRAZO_BOTOES_ERRADO_MS), {
      canalId: interaction.channelId, mensagemId: avisoId, avaliadoEm,
    }).catch(err => console.error('[manto] Erro ao agendar remoção dos botões:', err));
  }
  await fecharCasoAnterior(interaction.client, foto.anterior, interaction.user.id);

  // Caso no canal do motivo. Falhou? o erro JÁ está gravado (conta no placar); o
  // aviso ao avaliador diz que o card não saiu.
  let resposta = `${tema.emoji.recusado} Manto registrado como **ERRADO** — ${rotuloMotivo(motivo)}.`;
  try {
    const ctx = await repo.contextoDaFoto(fotoId);
    const historico = resumirFotos(await repo.fotosDoCandidato(ctx.candidato_id));
    const { canalId, mensagemId } = await casos.publicarCaso(
      interaction.guild, { ...ctx, reincidencia: historico.reincidente ? historico.erradosEfetivos : null }, await anexoDaFoto(interaction, fotoId)
    );
    await repo.gravarCaso(fotoId, { canalId, mensagemId });
    await agendarPrazoCaso(fotoId, mensagemId, 0);
    if (historico.reincidente) resposta += `\n🚩 **Candidato reincidente:** ${historico.erradosEfetivos} fotos reprovadas.`;
    resposta += `\n📂 Caso aberto em <#${canalId}>.`;
  } catch (err) {
    console.error('[manto] Erro ao abrir o caso do manto reprovado:', err);
    resposta += '\n⚠️ NÃO CONSEGUI ABRIR O CASO NO CANAL DO MOTIVO (veja permissões do bot). O erro foi registrado.';
  }
  const avisado = await avisarCandidato(interaction.client, foto.candidato_id, motivo);
  resposta += avisado ? '\n📩 Candidato avisado por DM.' : '\n⚠️ Não consegui avisar o candidato por DM (DM fechada).';
  painel.agendarAtualizacaoReativa(interaction.client);
  return interaction.update({ content: resposta, components: [] });
}

// Botão do card no canal do caso
async function resolverCaso(interaction, fotoId) {
  if (!(await podeAvaliar(interaction.member))) return semPermissao(interaction);
  const caso = await repo.resolverCaso(fotoId, interaction.user.id);
  if (!caso) return interaction.reply({ content: '⚠️ ESTE CASO JÁ FOI RESOLVIDO (OU O MANTO FOI REAVALIADO).', flags: 64 });
  const ctx = await repo.contextoDaFoto(fotoId);
  const status = casos.embedCaso(ctx, 'RESOLVIDO', { porId: interaction.user.id }).fields.at(-1);
  const embed = interaction.message.embeds[0];
  return interaction.update({
    embeds: [EmbedBuilder.from(embed).setColor(tema.cor.neutro).setFields((embed.fields ?? []).map(c => (c.name === 'STATUS' ? status : c)))],
    components: [],
    allowedMentions: { parse: [] },
  });
}

async function avaliar(interaction, acao, fotoId, avisoId) {
  if (acao === 'certo') return avaliarCerto(interaction, fotoId);
  if (acao === 'errado') return pedirMotivo(interaction, fotoId);
  if (acao === 'motivo') return registrarErrado(interaction, fotoId, avisoId);
  if (acao === 'resolver') return resolverCaso(interaction, fotoId);
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
  const [, acao, fotoId, avisoId] = interaction.customId.split(':');
  return avaliar(interaction, acao, fotoId, avisoId);
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

const POR_LINHA_SEM_AVALIACAO = 6;

// Dois níveis: menção + taxa em destaque; contagens no subtexto pequeno. A ordem
// é por volume de avaliações (não por taxa), então sem medalha/posição.
function linhaRecrutador(r) {
  const total = r.acertos + r.erros;
  const recuperados = r.recuperados ? ` · ${r.recuperados} recuperado(s)` : '';
  const top = r.motivoTop ? `\n-# Erra mais por: ${rotuloMotivo(r.motivoTop.motivo)} (${r.motivoTop.total})` : '';
  return `<@${r.id}> — **${r.taxa}%**\n`
    + `-# ${tema.emoji.ok} ${r.acertos} acertos · ${tema.emoji.recusado} ${r.erros} erros · ${total} avaliados${recuperados}${top}\n`;
}

// Quem avaliou, quanto e em quanto tempo (30 dias)
function linhaAvaliador(a) {
  return `<@${a.avaliado_por_id}> — **${a.total}** avaliações · tempo médio ${E.formatarDuracao(Math.round(a.media_s * 1000))}`;
}

// Quem ainda não teve foto avaliada não precisa de duas linhas cada: vira uma
// lista compacta de menções.
function linhasSemAvaliacao(recrutadores) {
  if (!recrutadores.length) return [];
  const linhas = [`**Sem avaliações ainda (${recrutadores.length})**`];
  for (let i = 0; i < recrutadores.length; i += POR_LINHA_SEM_AVALIACAO) {
    linhas.push(recrutadores.slice(i, i + POR_LINHA_SEM_AVALIACAO).map(r => `<@${r.id}>`).join(' · '));
  }
  return linhas;
}

async function montarBlocos() {
  const [linhas, ids, pendentes, motivos, avaliadores] = await Promise.all([
    repo.placarPorRecrutador(), idsRecrutadores(clientAtual), repo.contarPendentes(),
    repo.motivosPorRecrutador(), repo.desempenhoAvaliadores(30),
  ]);
  const { recrutadores, semRecrutador } = montarPlacar(linhas, ids, motivos);
  const avaliados = recrutadores.filter(r => r.acertos + r.erros > 0 && r.taxa !== null);
  const semAvaliacao = recrutadores.filter(r => !avaliados.includes(r));
  const linhasTexto = [...avaliados.map(linhaRecrutador), ...linhasSemAvaliacao(semAvaliacao)];
  if (semRecrutador.acertos + semRecrutador.erros > 0) {
    linhasTexto.push(`\n*Sem recrutador (ficha ainda não decidida):* ${tema.emoji.ok} ${semRecrutador.acertos} · ${tema.emoji.recusado} ${semRecrutador.erros}`);
  }
  return F.blocosDeEmbeds(F.embedsDeLista({
    titulo: '🧥 PLACAR DE MANTO POR RECRUTADOR',
    cabecalho: 'Acertos e erros das fotos de manto enviadas no provar-manto, avaliadas pela liderança. '
      + 'A foto conta para o recrutador que **aprovou a ficha** do candidato (ficha reprovada não conta contra ninguém). '
      + 'Erro **recuperado** = o candidato mandou depois uma foto correta; não conta contra o recrutador.\n'
      + `Fotos aguardando avaliação: **${pendentes}**`,
    linhas: linhasTexto,
    vazio: 'Nenhum recrutador encontrado.',
    fields: F.campoLista('AVALIADORES (30 DIAS)', avaliadores.map(linhaAvaliador), 'Ninguém avaliou nos últimos 30 dias.', { numerar: false }),
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

module.exports = { iniciarPainelManto, aoMensagem, botoesAvaliacao, lembrarFotoParada, lembrarPrazoCaso };
