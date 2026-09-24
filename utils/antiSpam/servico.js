const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, StickerFormatType } = require('discord.js');
const config = require('../../config/index.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca, temAlgumCargo, MSG_SO_LIDERANCA } = require('../permissoes');
const { registrarLogGestao } = require('../logGestao');
const { listarDepartamentos } = require('../departamentos/repositorio');
const { assinaturaMensagem, temLinkOuAnexo, avaliarHistorico, avaliarAltaCerteza } = require('./regras');
const tema = require('../../tema');

// antispam:banir:<userId> · antispam:liberar:<userId> · antispam:ignorar:<userId>

const historicoPorUsuario = new Map(); // userId → [{ canalId, mensagemId, assinatura, linkOuAnexo, anexos, em, conteudo }]
// Já pego. Com apagar: o spammer segue mandando depois de pego (o castigo leva
// um instante pra valer, ou nem há castigo) — até `ate`, tudo que ele postar
// some na hora. Sem apagar (só alerta): só não repete o alerta a cada mensagem.
const pegoAte = new Map(); // userId → { ate: ms, apagar: boolean }

const modoSoAlerta = () => config.antiSpam.modo !== 'punir';

function limparMemoria() {
  const agora = Date.now();
  const limite = config.antiSpam.historicoSegundos * 1000;
  for (const [userId, historico] of historicoPorUsuario) {
    if (!historico.some(h => agora - h.em <= limite)) historicoPorUsuario.delete(userId);
  }
  for (const [userId, pego] of pegoAte) {
    if (pego.ate <= agora) pegoAte.delete(userId);
  }
}
setInterval(limparMemoria, 5 * 60 * 1000).unref();

// Quem posta em vários canais de propósito: liderança (avisos), recrutador
// (vários tickets ao mesmo tempo) e gestor de departamento (divulgação da área).
async function isento(member) {
  if (!member) return false;
  if (ehLideranca(member)) return true;
  if (temAlgumCargo(member, config.antiSpam.cargosIsentos)) return true;
  const gestores = await listarDepartamentos({ apenasAtivos: true })
    .then(areas => areas.map(a => a.cargo_gestor_id))
    .catch(err => { console.error('[anti-spam] Erro ao ler gestores de departamento:', err.message); return []; });
  return temAlgumCargo(member, gestores);
}

// true = a mensagem era spam e já foi tratada (o resto do messageCreate não roda)
async function tratarSpam(message) {
  if (!message.guild || message.author.bot || message.webhookId || message.system) return false;
  const cfg = config.antiSpam;
  const userId = message.author.id;
  const agora = Date.now();

  const pego = pegoAte.get(userId);
  const jaPego = Boolean(pego && pego.ate > agora);
  if (jaPego && pego.apagar) {
    await message.delete().catch(() => {});
    return true;
  }
  // Já alertado sem apagar: segue acumulando — a rajada pode crescer até alta
  // certeza (a regra comum bate no 3º canal, a de alta certeza só no 4º).

  const anexos = [...message.attachments.values()].map(a => ({ nome: a.name, tamanho: a.size, url: a.url }));
  const figurinhas = [...message.stickers.values()].map(s => ({ id: s.id, nome: s.name, url: s.url, formato: s.format }));
  const historico = (historicoPorUsuario.get(userId) || [])
    .filter(h => agora - h.em <= cfg.historicoSegundos * 1000);
  historico.push({
    canalId: message.channelId,
    mensagemId: message.id,
    assinatura: assinaturaMensagem({ conteudo: message.content, anexos, figurinhas: figurinhas.map(f => f.id) }),
    linkOuAnexo: temLinkOuAnexo({ conteudo: message.content, anexos }),
    anexos,
    figurinhas,
    em: agora,
    conteudo: message.content,
  });
  historicoPorUsuario.set(userId, historico);

  const altaCerteza = avaliarAltaCerteza(historico, agora, cfg.altaCerteza);
  const resultado = altaCerteza.spam ? altaCerteza : avaliarHistorico(historico, agora, cfg);
  if (!resultado.spam) return false;
  if (jaPego && !altaCerteza.spam) return false; // já alertado: não repete o mesmo alerta
  // Isenção só é consultada quando a regra bate: evita ler cargos a cada mensagem
  if (await isento(message.member)) return false;

  // Baixa os arquivos AGORA — a URL do Discord morre assim que a mensagem é
  // apagada (é o que acontecia antes: o alerta linkava pra uma URL já morta).
  const amostraArquivos = await baixarAmostra(historico);

  // Alta certeza apaga mesmo em modo só alerta; o resto só apaga em modo punir
  const apagar = !modoSoAlerta() || altaCerteza.spam;
  pegoAte.set(userId, { ate: agora + cfg.apagarNaHoraSegundos * 1000, apagar });
  // Só alerta: mantém o histórico pra poder escalar se a rajada continuar
  if (apagar) historicoPorUsuario.delete(userId);

  if (modoSoAlerta() && apagar) {
    // Alta certeza (mesmos arquivos replicados em vários canais) não dá pra
    // ser engano — castiga sozinho mesmo em modo alerta. Só nunca bane sozinho.
    const acaoCastigo = await aplicarCastigo(message.guild, message.author, message.member, cfg.castigoHoras,
      `Anti-spam (alta certeza): ${resultado.arquivos} arquivos em ${resultado.canais} canais`);
    const { apagadas, total } = await apagarMensagens(message.guild, historico);
    console.log(`[anti-spam] (alta certeza) ${message.author.tag} (${userId}): ${resultado.arquivos} arquivos em ${resultado.canais} canais — ${acaoCastigo}, ${apagadas}/${total} apagadas`);
    await enviarAlerta(message.guild, message.author, historico, resultado, {
      acao: `🧹 APAGADO AUTOMATICAMENTE (ALTA CERTEZA) — ${acaoCastigo}`,
      apagadas: `${apagadas} de ${total}`,
    }, amostraArquivos).catch(err => console.error('[anti-spam] Erro ao alertar:', err));
    return true;
  }
  if (modoSoAlerta()) {
    console.log(`[anti-spam] (só alerta) ${message.author.tag} (${userId}): ${resultado.motivo} em ${resultado.canais} canais`);
    await enviarAlerta(message.guild, message.author, historico, resultado, {
      acao: '👀 MODO SÓ ALERTA — NADA FOI FEITO',
      apagadas: 'nenhuma (modo só alerta)',
    }, amostraArquivos).catch(err => console.error('[anti-spam] Erro ao alertar:', err));
    return false;
  }
  await punir(message, historico, resultado, amostraArquivos).catch(err => console.error('[anti-spam] Erro ao punir:', err));
  return true;
}

// Nunca bane sozinho — só castiga (timeout). Banir é decisão manual (botão).
async function aplicarCastigo(guild, author, membroJaCarregado, horas, motivo) {
  const membro = membroJaCarregado ?? await guild.members.fetch(author.id).catch(() => null);
  if (!membro) return '⚠️ SAIU DO SERVIDOR ANTES DO CASTIGO';
  if (!membro.moderatable) return '⚠️ SEM CASTIGO: CARGO ACIMA DO BOT OU BOT SEM PERMISSÃO "CASTIGAR MEMBROS"';
  return membro.timeout(horas * 3600 * 1000, motivo)
    .then(() => `⏳ CASTIGO DE ${horas}H`)
    .catch(err => `⚠️ CASTIGO FALHOU: ${err.message}`);
}

async function punir(message, historico, resultado, amostraArquivos) {
  const { guild, author } = message;
  const cfg = config.antiSpam;

  const acao = await aplicarCastigo(guild, author, message.member, cfg.castigoHoras, `Anti-spam: mesma mensagem em ${resultado.canais} canais`);

  const { apagadas, total } = await apagarMensagens(guild, historico);
  console.log(`[anti-spam] ${author.tag} (${author.id}): ${resultado.motivo} em ${resultado.canais} canais — ${acao}, ${apagadas}/${total} apagadas`);
  await enviarAlerta(guild, author, historico, resultado, { acao, apagadas: `${apagadas} de ${total}` }, amostraArquivos);
}

async function apagarMensagens(guild, historico) {
  const idsPorCanal = new Map();
  for (const h of historico) {
    if (!idsPorCanal.has(h.canalId)) idsPorCanal.set(h.canalId, []);
    idsPorCanal.get(h.canalId).push(h.mensagemId);
  }
  let apagadas = 0;
  await Promise.all([...idsPorCanal].map(async ([canalId, ids]) => {
    const canal = guild.channels.cache.get(canalId) ?? await guild.channels.fetch(canalId).catch(() => null);
    if (!canal?.messages) return;
    if (ids.length === 1) {
      if (await canal.messages.delete(ids[0]).then(() => true).catch(() => false)) apagadas += 1;
      return;
    }
    const removidas = await canal.bulkDelete(ids, true).catch(() => null);
    apagadas += removidas?.size ?? 0;
  }));
  return { apagadas, total: historico.length };
}

const EXT_IMAGEM = /\.(png|jpe?g|gif|webp)$/i;

function amostraDoTexto(historico) {
  const texto = historico.find(h => h.conteudo)?.conteudo;
  if (!texto) return null;
  return `\`\`\`${texto.replace(/`/g, 'ˋ').slice(0, 500)}\`\`\``;
}

// Baixa os arquivos/figurinhas (imagem/gif) da rajada e devolve prontos pra
// reanexar no próprio alerta — a URL original do Discord some quando a
// mensagem é apagada, então isso tem que rodar ANTES de apagarMensagens.
// Nada é salvo em disco/banco: só passa pela memória a caminho do Discord.
async function baixarAmostra(historico) {
  const { max, maxBytes } = config.antiSpam.amostraImagens;
  const vistos = new Set();
  const candidatos = [];
  for (const h of historico) {
    if (candidatos.length >= max) break;
    for (const a of h.anexos || []) {
      if (!a.url || vistos.has(a.nome) || !EXT_IMAGEM.test(a.nome || '')) continue;
      vistos.add(a.nome);
      candidatos.push({ nome: a.nome, url: a.url });
    }
    for (const f of h.figurinhas || []) {
      if (!f.url || vistos.has(f.nome) || f.formato === StickerFormatType.Lottie) continue;
      vistos.add(f.nome);
      const ext = f.formato === StickerFormatType.GIF ? 'gif' : 'png';
      candidatos.push({ nome: `${f.nome.replace(/[^\w.-]/g, '_')}.${ext}`, url: f.url });
    }
  }

  const arquivos = [];
  for (const { nome, url } of candidatos.slice(0, max)) {
    try {
      const resposta = await fetch(url);
      if (!resposta.ok) continue;
      const buffer = Buffer.from(await resposta.arrayBuffer());
      if (buffer.length > maxBytes) continue;
      arquivos.push(new AttachmentBuilder(buffer, { name: nome }));
    } catch (err) {
      console.error(`[anti-spam] Erro ao baixar amostra (${nome}):`, err.message);
    }
  }
  return arquivos;
}

function amostraValor(historico, temArquivos) {
  const texto = amostraDoTexto(historico);
  if (texto) return texto;
  if (temArquivos) return '*(arquivos anexados abaixo)*';
  return '*(sem conteúdo)*';
}

async function enviarAlerta(guild, author, historico, resultado, { acao, apagadas }, amostraArquivos = []) {
  const canalId = config.canais.antiSpam;
  const canal = canalId ? await guild.channels.fetch(canalId).catch(() => null) : null;
  if (!canal) {
    console.warn('[anti-spam] Canal de alerta não configurado (config.canais.antiSpam) — alerta só no console.');
    return;
  }
  const canais = [...new Set(historico.map(h => h.canalId))];
  const listaCanais = canais.slice(0, 15).map(id => `<#${id}>`).join(' ') + (canais.length > 15 ? ` +${canais.length - 15}` : '');
  const soAlerta = modoSoAlerta();
  const altaCerteza = resultado.motivo === 'anexos_replicados';
  const descricoes = {
    anexos_replicados: `**${resultado.arquivos} arquivos iguais** replicados em **${resultado.canais} canais** em até ${config.antiSpam.altaCerteza.janelaSegundos}s.`,
    mesma_mensagem: `Mesma mensagem em **${resultado.canais} canais** em até ${config.antiSpam.janelaSegundos}s.`,
    varios_canais: `Mensagens com link/anexo em **${resultado.canais} canais diferentes** em até ${config.antiSpam.janelaSegundos}s.`,
  };
  let titulo = '🛡️ CONTA SUSPEITA DE HACK — SPAM EM VÁRIOS CANAIS';
  let aviso = '';
  if (soAlerta && altaCerteza) {
    titulo = '🧹 SPAM APAGADO E CASTIGADO AUTOMATICAMENTE — ARQUIVOS REPLICADOS';
    aviso = '\n\nCastigo automático já aplicado (alta certeza). Se era spam de verdade, bana abaixo — mensagens apagadas não voltam. Se não era, marque NÃO ERA SPAM pra remover o castigo.';
  } else if (soAlerta) {
    titulo = '👀 TERIA SIDO PEGO PELO ANTI-SPAM';
    aviso = '\n\nModo de teste: confira se era spam de verdade e marque abaixo.';
  }

  await canal.send({
    embeds: [{
      color: tema.cor.primaria,
      title: titulo,
      description: descricoes[resultado.motivo] + aviso,
      thumbnail: { url: author.displayAvatarURL() },
      image: amostraArquivos[0] ? { url: `attachment://${amostraArquivos[0].name}` } : undefined,
      fields: [
        { name: 'MEMBRO', value: `<@${author.id}>\n\`${author.tag}\` · \`${author.id}\``, inline: true },
        { name: 'AÇÃO AUTOMÁTICA', value: acao, inline: true },
        { name: 'MENSAGENS APAGADAS', value: apagadas, inline: true },
        { name: 'CANAIS ATINGIDOS', value: listaCanais || '—' },
        { name: 'AMOSTRA', value: amostraValor(historico, amostraArquivos.length > 0) },
        { name: 'DATA', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
      ],
    }],
    files: amostraArquivos,
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`antispam:banir:${author.id}`).setLabel('BANIR').setEmoji('🔨').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`antispam:castigar:${author.id}`).setLabel(`CASTIGO ${config.antiSpam.castigoManualDias}D`).setEmoji('⏳').setStyle(ButtonStyle.Primary),
      soAlerta
        ? new ButtonBuilder().setCustomId(`antispam:ignorar:${author.id}`).setLabel('NÃO ERA SPAM').setEmoji('👍').setStyle(ButtonStyle.Secondary)
        : new ButtonBuilder().setCustomId(`antispam:liberar:${author.id}`).setLabel('LIBERAR').setEmoji(tema.emoji.ok).setStyle(ButtonStyle.Secondary),
    )],
    allowedMentions: { parse: [] },
  });
}

registrarModulo('antispam', async interaction => {
  if (!interaction.isButton()) return;
  if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
  const [, acao, userId] = interaction.customId.split(':');
  const { guild, user: ator } = interaction;
  await interaction.deferUpdate();

  let decisao;
  try {
    if (acao === 'banir') {
      await guild.members.ban(userId, { deleteMessageSeconds: 3600, reason: `Anti-spam: conta comprometida — banido por ${ator.tag}` });
      decisao = '🔨 BANIDO';
    } else if (acao === 'castigar') {
      const membro = await guild.members.fetch(userId).catch(() => null);
      if (!membro) return interaction.followUp({ content: '❌ ESSE MEMBRO NÃO ESTÁ MAIS NO SERVIDOR.', flags: 64 });
      if (!membro.moderatable) return interaction.followUp({ content: '❌ NÃO FOI POSSÍVEL CASTIGAR: CARGO ACIMA DO BOT OU BOT SEM PERMISSÃO "CASTIGAR MEMBROS".', flags: 64 });
      const dias = config.antiSpam.castigoManualDias;
      await membro.timeout(dias * 24 * 3600 * 1000, `Anti-spam: castigo manual por ${ator.tag}`);
      pegoAte.delete(userId);
      decisao = `⏳ CASTIGO DE ${dias} DIAS`;
    } else if (acao === 'liberar') {
      const membro = await guild.members.fetch(userId).catch(() => null);
      if (!membro) return interaction.followUp({ content: '❌ ESSE MEMBRO NÃO ESTÁ MAIS NO SERVIDOR.', flags: 64 });
      await membro.timeout(null, `Anti-spam: liberado por ${ator.tag}`);
      pegoAte.delete(userId);
      decisao = `${tema.emoji.ok} LIBERADO (CASTIGO REMOVIDO)`;
    } else if (acao === 'ignorar') {
      // Alta certeza já pode ter castigado sozinho — remove o castigo se houver
      const membro = await guild.members.fetch(userId).catch(() => null);
      if (membro?.communicationDisabledUntil) await membro.timeout(null, `Anti-spam: falso positivo, marcado por ${ator.tag}`).catch(() => {});
      pegoAte.delete(userId);
      decisao = '👍 NÃO ERA SPAM (FALSO POSITIVO)';
    } else {
      return;
    }
  } catch (err) {
    // Alerta segue com os botões: nada foi feito de fato
    return interaction.followUp({ content: `❌ NÃO FOI POSSÍVEL CONCLUIR: ${err.message}`, flags: 64 });
  }

  const embed = interaction.message.embeds[0]?.toJSON() ?? {};
  embed.fields = [...(embed.fields || []), { name: 'DECISÃO', value: `${decisao} por <@${ator.id}>` }];
  await interaction.editReply({ embeds: [embed], components: [] });
  await registrarLogGestao(interaction.client, {
    titulo: `🛡️ ANTI-SPAM — ${decisao}`,
    ator: ator.id,
    campos: [{ name: 'MEMBRO', value: `<@${userId}> · \`${userId}\``, inline: true }],
  });
});

module.exports = { tratarSpam };
