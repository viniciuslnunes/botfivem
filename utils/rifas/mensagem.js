const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../../config/index.js');
const { formatarDinheiro, formatarNumero, truncar } = require('../logsJogo/estatisticas');
const { urlDaMidia } = require('../arquivoMidia');
const repo = require('./repositorio');
const R = require('./regras');
const tema = require('../../tema');

// A mensagem da rifa é sempre reconstruída a partir do banco — nunca editada "de cabeça"

const unix = d => Math.floor(new Date(d).getTime() / 1000);

function linkDaMensagem(rifa) {
  return rifa.message_id ? `https://discord.com/channels/${config.guildId}/${rifa.canal_id}/${rifa.message_id}` : null;
}

function linkDaReferencia(ref) {
  if (!ref) return null;
  const [canalId, mensagemId] = String(ref).split('/');
  return `https://discord.com/channels/${config.guildId}/${canalId}/${mensagemId}`;
}

function listarNumeros(numeros, rifa, max = 1000) {
  return truncar(R.faixasCompactas(numeros, rifa.total_numeros).join(', '), max) || '—';
}

function montarMensagemRifa(rifa, { reservados = 0, imagemUrl = null } = {}) {
  const total = rifa.total_numeros;
  const f = n => R.formatarNumero(n, total);
  const status = R.STATUS_RIFA[rifa.status] ?? R.STATUS_RIFA.ABERTA;
  const vendendo = rifa.status === 'ABERTA';
  const progresso = R.progressoVenda({ totalNumeros: total, vendidos: rifa.vendidos });
  const limiar = R.progressoLimiar({ totalNumeros: total, vendidos: rifa.vendidos, pct: rifa.limiar_sorteio_pct });
  const metodo = R.METODOS_SORTEIO[rifa.metodo_sorteio] ?? R.METODOS_SORTEIO.MANUAL;

  const fields = [
    { name: '🎁 PRÊMIO', value: truncar(rifa.premio, 1000), inline: false },
    { name: '💵 POR NÚMERO', value: formatarDinheiro(rifa.preco), inline: true },
    {
      name: '👤 LIMITE POR PESSOA',
      value: rifa.limite_por_pessoa ? `${rifa.limite_por_pessoa} número${rifa.limite_por_pessoa !== 1 ? 's' : ''}` : 'Sem limite',
      inline: true,
    },
    {
      name: '🎟️ VENDIDOS',
      value: `${R.barraProgresso(rifa.vendidos / total)} ${formatarNumero(rifa.vendidos)}/${formatarNumero(total)} (${progresso.percentual}%)`
        + (vendendo && reservados ? `\n⏳ ${reservados} reservado${reservados !== 1 ? 's' : ''} agora, aguardando pagamento` : ''),
      inline: false,
    },
  ];

  if (rifa.status === 'ABERTA' || rifa.status === 'ENCERRADA') {
    fields.push({
      name: '⏳ VENDAS',
      value: rifa.status === 'ENCERRADA'
        ? 'Encerradas'
        : rifa.encerra_em ? `Até <t:${unix(rifa.encerra_em)}:F> (<t:${unix(rifa.encerra_em)}:R>)` : 'Até a organização encerrar',
      inline: true,
    });
    fields.push({
      name: '📅 SORTEIO',
      value: rifa.sorteio_em
        ? `<t:${unix(rifa.sorteio_em)}:F>`
        : limiar.atingido
          ? `Meta de ${limiar.pct}% vendidos atingida — data a ser divulgada`
          : `Data divulgada ao atingir ${limiar.pct}% vendidos — faltam **${formatarNumero(limiar.faltam)} números**`,
      inline: true,
    });
  }

  const comoSorteia = [`**${metodo.rotulo}.** ${metodo.descricao}`];
  if (rifa.metodo_sorteio === 'MANUAL') {
    comoSorteia.push(`Se o número sorteado não foi vendido, ${R.REGRAS_NAO_VENDIDO[rifa.regra_nao_vendido]?.rotulo ?? '—'}.`);
  }
  if (rifa.compromisso_hash) comoSorteia.push(`Compromisso (SHA-256 da semente): \`${rifa.compromisso_hash}\``);
  fields.push({ name: '🎲 COMO É SORTEADO', value: comoSorteia.join('\n'), inline: false });

  if (rifa.status === 'SORTEADA') {
    const resultado = [`Número **${f(rifa.numero_vencedor)}** — <@${rifa.vencedor_id}>`];
    if (rifa.numero_sorteado !== rifa.numero_vencedor) {
      resultado.push(`Sorteado ao vivo: ${f(rifa.numero_sorteado)}, que não foi vendido → próximo número vendido.`);
    }
    if (rifa.metodo_sorteio === 'SISTEMA') resultado.push(`Semente revelada: \`${rifa.semente}\``);
    resultado.push(`Hash da lista de números pagos: \`${rifa.hash_lista_final}\``);
    const evidencia = rifa.evidencia || linkDaReferencia(rifa.evidencia_ref);
    if (evidencia) resultado.push(`Evidência: ${evidencia}`);
    fields.push({ name: '🏆 RESULTADO', value: truncar(resultado.join('\n'), 1024), inline: false });
  }
  if (rifa.status === 'CANCELADA') {
    fields.push({ name: '❌ CANCELADA', value: truncar(rifa.cancelada_motivo || 'Motivo não informado.', 1000), inline: false });
  }

  const descricao = [
    rifa.descricao,
    vendendo
      ? `Pagamento **no jogo**, a um responsável da rifa. Seus números ficam reservados por ${R.MINUTOS_RESERVA} minutos até você avisar que pagou.`
      : null,
  ].filter(Boolean).join('\n\n');

  const embed = {
    color: rifa.status === 'CANCELADA' ? tema.cor.perigo : rifa.status === 'SORTEADA' ? tema.cor.aviso : tema.cor.primaria,
    title: truncar(`${status.emoji} RIFA — ${rifa.titulo.toUpperCase()}`, 256),
    description: descricao || null,
    fields,
    footer: { text: `RIFA #${rifa.id} · ${status.rotulo.toUpperCase()}` },
    ...(imagemUrl ? { image: { url: imagemUrl } } : {}),
  };

  const botoes = [];
  if (vendendo) {
    botoes.push(new ButtonBuilder().setCustomId(`rifa:comprar:${rifa.id}`).setLabel('COMPRAR NÚMEROS').setEmoji('🎟️').setStyle(ButtonStyle.Secondary));
  }
  if (rifa.status !== 'CANCELADA') {
    botoes.push(new ButtonBuilder().setCustomId(`rifa:meus:${rifa.id}`).setLabel('MEUS NÚMEROS').setStyle(ButtonStyle.Secondary));
  }
  return {
    embeds: [embed],
    components: botoes.length ? [new ActionRowBuilder().addComponents(...botoes)] : [],
    allowedMentions: { parse: [] },
  };
}

async function mensagemDaRifa(client, rifa) {
  const [reservados, imagemUrl] = await Promise.all([
    repo.contarReservados(rifa.id),
    urlDaMidia(client, rifa.imagem_ref).catch(() => null),
  ]);
  return montarMensagemRifa(rifa, { reservados, imagemUrl });
}

async function publicarRifa(client, rifa) {
  const canal = await client.channels.fetch(rifa.canal_id).catch(() => null);
  if (!canal?.isTextBased()) throw new Error(`Canal da rifa #${rifa.id} não encontrado.`);
  const mensagem = await canal.send(await mensagemDaRifa(client, rifa));
  await repo.gravarMensagem(rifa.id, mensagem.id);
  return mensagem;
}

async function atualizarMensagemRifa(client, rifaId) {
  const rifa = await repo.buscarRifa(rifaId);
  if (!rifa?.message_id) return;
  const canal = await client.channels.fetch(rifa.canal_id).catch(() => null);
  const mensagem = canal ? await canal.messages.fetch(rifa.message_id).catch(() => null) : null;
  if (!mensagem) return;
  await mensagem.edit(await mensagemDaRifa(client, rifa));
}

// Conferência da equipe. `decisao` fecha a mensagem: sem botões, com quem decidiu
function montarMensagemPagamento({ compra, rifa, numeros, decisao = null }) {
  const embed = {
    color: decisao ? decisao.cor : tema.cor.aviso,
    title: `🎟️ PAGAMENTO DE RIFA — COMPRA #${compra.id}`,
    description: decisao ? null : 'O comprador avisou que pagou **no jogo**. Confira o recebimento antes de confirmar.',
    fields: [
      { name: 'RIFA', value: truncar(`#${rifa.id} ${rifa.titulo}`, 1000), inline: true },
      { name: 'COMPRADOR', value: `<@${compra.discord_id}>`, inline: true },
      { name: 'TOTAL', value: formatarDinheiro(compra.total), inline: true },
      { name: `NÚMEROS (${numeros.length})`, value: listarNumeros(numeros, rifa), inline: false },
      ...(decisao ? [{ name: 'SITUAÇÃO', value: decisao.texto, inline: false }] : []),
    ],
  };
  const components = decisao ? [] : [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rifa:confirmar:${compra.id}`).setLabel('CONFIRMAR PAGAMENTO').setEmoji('🤝').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`rifa:recusar:${compra.id}`).setLabel('NÃO RECEBI').setStyle(ButtonStyle.Danger)
  )];
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

async function fecharMensagemPagamento(client, ref, { texto, cor }) {
  if (!ref) return;
  const [canalId, mensagemId] = String(ref).split('/');
  const canal = await client.channels.fetch(canalId).catch(() => null);
  const mensagem = canal ? await canal.messages.fetch(mensagemId).catch(() => null) : null;
  if (!mensagem?.embeds[0]) return;
  const embed = EmbedBuilder.from(mensagem.embeds[0]).setColor(cor).setDescription(null)
    .addFields({ name: 'SITUAÇÃO', value: texto, inline: false });
  await mensagem.edit({ embeds: [embed], components: [], allowedMentions: { parse: [] } });
}

// Painel fixo do canal de rifas (sempre por último): explica a mecânica e abre a gestão
function montarPainelRifas() {
  return {
    embeds: [{
      color: tema.cor.primaria,
      title: tema.tituloSegmentado('🎟️ RIFAS DA TORCIDA'),
      description: [
        'Rifas pagas **em dinheiro do jogo**, só para sócios.',
        '',
        '• Cada rifa aparece aqui com prêmio, preço, números livres e prazo. Clique em **COMPRAR** na rifa.',
        '• O número fica **reservado** por alguns minutos: pague no jogo e avise em **JÁ PAGUEI**. A equipe confere e confirma.',
        '• No sorteio pelo bot, o **compromisso (hash)** é publicado antes da primeira venda e o **arquivo de auditoria** sai junto do resultado: qualquer um confere.',
        '• Rifa cancelada? Quem pagou recebe a devolução no jogo.',
        '',
        '_Só a presidência e o gestor de Social e Eventos criam e conduzem._',
      ].join('\n'),
    }],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('rifa:lista').setLabel('RIFAS EM ANDAMENTO').setEmoji('🎟️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('rifa:novo').setLabel('NOVA RIFA').setEmoji('➕').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('rifa:gerir').setLabel('GERIR').setEmoji('🛠️').setStyle(ButtonStyle.Secondary)
    )],
  };
}

module.exports = {
  montarMensagemRifa,
  publicarRifa,
  atualizarMensagemRifa,
  montarPainelRifas,
  montarMensagemPagamento,
  fecharMensagemPagamento,
  linkDaMensagem,
  listarNumeros,
};
