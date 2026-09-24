const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const config = require('../../config/index.js');
const { registrarModulo } = require('../modulos');
const { agendar } = require('../agendador');
const { registrarLogGestao } = require('../logGestao');
const { formatarDinheiro, formatarNumero, truncar } = require('../logsJogo/estatisticas');
const { avisarPorDM } = require('../eventos/interacoes');
const repo = require('./repositorio');
const R = require('./regras');
const { atualizarMensagemRifa, montarMensagemPagamento, listarNumeros } = require('./mensagem');
const { canalDePagamentos } = require('./estrutura');
const { podeConfirmarPagamentos } = require('./permissoes');
const tema = require('../../tema');
require('./tarefas'); // registra expiração de reserva e encerramento no prazo

// rifa:comprar:<rifa> · rifa:escolher:<rifa> · rifa:aleatorio:<rifa> · rifa:meus:<rifa>
// rifa:numeros:<rifa> e rifa:quantidade:<rifa> (modais)
// rifa:paguei:<compra> · rifa:desistir:<compra> · rifa:confirmar:<compra> · rifa:recusar:<compra>

const unix = d => Math.floor(new Date(d).getTime() / 1000);
const soSocio = interaction => interaction.member?.roles.cache.has(config.cargos.socio);
const MSG_SO_SOCIO = '❌ SÓ SÓCIOS PODEM COMPRAR NÚMEROS DAS RIFAS DA TORCIDA.';
const MSG_FECHADA = '⏳ ESTA RIFA NÃO ESTÁ MAIS VENDENDO.';

function atualizarPublica(client, rifaId) {
  return atualizarMensagemRifa(client, rifaId).catch(err => console.error('[rifas] Erro ao atualizar mensagem:', err));
}

function botoesReserva(compraId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rifa:paguei:${compraId}`).setLabel(`JÁ PAGUEI · #${compraId}`).setEmoji('💵').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`rifa:desistir:${compraId}`).setLabel('DESISTIR').setStyle(ButtonStyle.Danger)
  );
}

function textoSituacaoCompra(compra) {
  return {
    PAGA: `${tema.emoji.ok} ESTE PAGAMENTO JÁ FOI CONFIRMADO.`,
    AGUARDANDO: '⏳ VOCÊ JÁ AVISOU ESTE PAGAMENTO. A EQUIPE VAI CONFERIR.',
    EXPIRADA: '⌛ ESTA RESERVA VENCEU E OS NÚMEROS VOLTARAM PARA A VENDA.',
    CANCELADA: '❌ ESTA RESERVA FOI CANCELADA.',
  }[compra.status] ?? '⚠️ ESTA RESERVA NÃO ESTÁ MAIS ABERTA.';
}

async function abrirCompra(interaction, rifaId) {
  if (!soSocio(interaction)) return interaction.reply({ content: MSG_SO_SOCIO, flags: 64 });
  const rifa = await repo.buscarRifa(rifaId);
  if (!rifa || !R.aceitaVenda(rifa)) return interaction.reply({ content: MSG_FECHADA, flags: 64 });

  const [ocupados, meus] = await Promise.all([repo.numerosOcupados(rifa.id), repo.bilhetesDaPessoa(rifa.id, interaction.user.id)]);
  const saldo = R.saldoLimite(rifa.limite_por_pessoa, meus.length);
  if (saldo === 0) {
    return interaction.reply({
      content: `⚠️ VOCÊ JÁ TEM ${meus.length} NÚMEROS NESTA RIFA, O LIMITE POR PESSOA. RESERVA QUE VOCÊ NÃO VAI PAGAR PODE SER CANCELADA EM **MEUS NÚMEROS**.`,
      flags: 64,
    });
  }
  const livres = R.numerosLivres(rifa.total_numeros, new Set(ocupados));
  if (!livres.length) {
    return interaction.reply({ content: `🎟️ TODOS OS NÚMEROS ESTÃO VENDIDOS OU RESERVADOS. RESERVA NÃO PAGA VOLTA PARA A VENDA EM ATÉ ${R.MINUTOS_RESERVA} MINUTOS.`, flags: 64 });
  }
  const podeLevar = Math.min(saldo ?? R.MAX_NUMEROS_POR_COMPRA, R.MAX_NUMEROS_POR_COMPRA, livres.length);
  return interaction.reply({
    content: [
      `**🎟️ ${rifa.titulo.toUpperCase()}** · ${formatarDinheiro(rifa.preco)} por número`,
      `**Livres (${formatarNumero(livres.length)}):** ${truncar(R.faixasCompactas(livres, rifa.total_numeros).join(', '), 1200)}`,
      `Você pode levar até **${podeLevar}** número${podeLevar !== 1 ? 's' : ''} nesta compra${meus.length ? ` (já tem ${meus.length})` : ''}.`,
    ].join('\n'),
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`rifa:escolher:${rifa.id}`).setLabel('ESCOLHER NÚMEROS').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`rifa:aleatorio:${rifa.id}`).setLabel('NÚMEROS ALEATÓRIOS').setEmoji('🎲').setStyle(ButtonStyle.Secondary)
    )],
    flags: 64,
  });
}

function modalNumeros(rifaId) {
  return new ModalBuilder()
    .setCustomId(`rifa:numeros:${rifaId}`)
    .setTitle('ESCOLHER NÚMEROS')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('numeros').setLabel('NÚMEROS (EX.: 7, 13, 20-22)')
      .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(300)));
}

function modalQuantidade(rifaId) {
  return new ModalBuilder()
    .setCustomId(`rifa:quantidade:${rifaId}`)
    .setTitle('NÚMEROS ALEATÓRIOS')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('quantidade').setLabel(`QUANTOS NÚMEROS? (1 A ${R.MAX_NUMEROS_POR_COMPRA})`)
      .setStyle(TextInputStyle.Short).setRequired(true).setValue('1').setMaxLength(2)));
}

function mensagemErroReserva(r, rifa) {
  if (r.erro === 'limite') {
    return r.saldo
      ? `⚠️ PELO LIMITE POR PESSOA, VOCÊ SÓ PODE LEVAR MAIS ${r.saldo} NÚMERO${r.saldo !== 1 ? 'S' : ''} NESTA RIFA. NADA FOI RESERVADO.`
      : '⚠️ VOCÊ JÁ ATINGIU O LIMITE DE NÚMEROS POR PESSOA NESTA RIFA.';
  }
  if (r.erro === 'indisponiveis') {
    return `❌ ESTE${r.numeros.length !== 1 ? 'S NÚMEROS JÁ ESTÃO' : ' NÚMERO JÁ ESTÁ'} RESERVADO${r.numeros.length !== 1 ? 'S' : ''} OU VENDIDO${r.numeros.length !== 1 ? 'S' : ''}: **${listarNumeros(r.numeros, rifa, 800)}**. NADA FOI RESERVADO — ESCOLHA OUTROS.`;
  }
  if (r.erro === 'sem_numeros') return `❌ SÓ RESTAM ${r.livres} NÚMERO${r.livres !== 1 ? 'S' : ''} LIVRE${r.livres !== 1 ? 'S' : ''}. NADA FOI RESERVADO.`;
  return MSG_FECHADA;
}

function montarReserva(compra, rifa, numeros) {
  return {
    content: [
      `🎟️ **RESERVA #${compra.id}** — ${rifa.titulo}`,
      `Números: **${listarNumeros(numeros, rifa, 800)}**`,
      `Total: **${formatarDinheiro(compra.total)}** (${numeros.length} × ${formatarDinheiro(rifa.preco)})`,
      '',
      `1. Pague **${formatarDinheiro(compra.total)}** **no jogo** a um responsável da rifa.`,
      '2. Clique em **JÁ PAGUEI**: seus números ficam guardados até a equipe conferir.',
      '',
      `⏳ Sem o aviso, a reserva cai <t:${unix(compra.expira_em)}:R> e os números voltam para a venda. Se fechar esta mensagem, use **MEUS NÚMEROS** na rifa.`,
    ].join('\n'),
    components: [botoesReserva(compra.id)],
  };
}

async function reservar(interaction, rifaId, modo) {
  if (!soSocio(interaction)) return interaction.reply({ content: MSG_SO_SOCIO, flags: 64 });
  const rifa = await repo.buscarRifa(rifaId);
  if (!rifa) return interaction.reply({ content: MSG_FECHADA, flags: 64 });

  let numeros = null;
  let quantidade = null;
  if (modo === 'numeros') {
    const lidos = R.parseNumeros(interaction.fields.getTextInputValue('numeros'), rifa.total_numeros);
    if (lidos.erro) return interaction.reply({ content: lidos.erro, flags: 64 });
    numeros = lidos.numeros;
  } else {
    quantidade = Number(interaction.fields.getTextInputValue('quantidade').trim());
    if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > R.MAX_NUMEROS_POR_COMPRA) {
      return interaction.reply({ content: `❌ QUANTIDADE INVÁLIDA. ESCOLHA DE 1 A ${R.MAX_NUMEROS_POR_COMPRA}.`, flags: 64 });
    }
  }

  await interaction.deferReply({ flags: 64 });
  const r = await repo.reservar({ rifaId: rifa.id, discordId: interaction.user.id, numeros, quantidade });
  if (r.erro) return interaction.editReply({ content: mensagemErroReserva(r, rifa) });

  // Sem a tarefa a reserva ainda vence: número vencido é retomável na próxima compra
  await agendar('rifa_expirar_compra', new Date(r.compra.expira_em), { compraId: r.compra.id })
    .catch(err => console.error('[rifas] Erro ao agendar expiração da reserva:', err));
  atualizarPublica(interaction.client, rifa.id);
  return interaction.editReply(montarReserva(r.compra, r.rifa, r.numeros));
}

async function avisarPagamento(interaction, compraId) {
  const compra = await repo.buscarCompra(compraId);
  if (!compra || compra.discord_id !== interaction.user.id) return interaction.reply({ content: '❌ ESTA RESERVA NÃO É SUA.', flags: 64 });
  if (compra.status !== 'PENDENTE') return interaction.update({ content: textoSituacaoCompra(compra), components: [] });
  const canal = await canalDePagamentos(interaction.client);
  if (!canal) {
    return interaction.reply({
      content: '❌ O CANAL DE CONFERÊNCIA DE PAGAMENTOS NÃO ESTÁ CONFIGURADO. AVISE A ORGANIZAÇÃO (`/rifa setup`). SUA RESERVA CONTINUA VALENDO ATÉ O PRAZO.',
      flags: 64,
    });
  }

  await interaction.deferUpdate();
  const [rifa, numeros] = await Promise.all([repo.buscarRifa(compra.rifa_id), repo.numerosDaCompra(compra.id)]);
  // A equipe é avisada antes de o banco mudar: se o aviso falhar, a reserva segue como estava
  let mensagemEquipe;
  try {
    mensagemEquipe = await canal.send(montarMensagemPagamento({ compra, rifa, numeros }));
  } catch (err) {
    console.error('[rifas] Erro ao avisar a equipe:', err);
    return interaction.followUp({ content: '❌ NÃO CONSEGUI AVISAR A EQUIPE AGORA. TENTE DE NOVO EM INSTANTES — SUA RESERVA CONTINUA VALENDO ATÉ O PRAZO.', flags: 64 });
  }

  const r = await repo.avisarPagamento(compra.id, interaction.user.id);
  if (r.erro) {
    await mensagemEquipe.delete().catch(() => {});
    if (r.erro === 'expirada') {
      atualizarPublica(interaction.client, compra.rifa_id);
      return interaction.editReply({
        content: '❌ A RESERVA VENCEU E PARTE DOS NÚMEROS JÁ FOI PARA OUTRA PESSOA. SE VOCÊ JÁ PAGOU, CHAME A ORGANIZAÇÃO PARA A DEVOLUÇÃO NO JOGO.',
        components: [],
      });
    }
    if (r.erro === 'rifa_fechada') {
      return interaction.editReply({ content: '❌ A RIFA JÁ FOI SORTEADA OU CANCELADA. SE VOCÊ PAGOU, CHAME A ORGANIZAÇÃO PARA A DEVOLUÇÃO NO JOGO.', components: [] });
    }
    return interaction.editReply({ content: r.compra ? textoSituacaoCompra(r.compra) : '❌ RESERVA NÃO ENCONTRADA.', components: [] });
  }

  await repo.gravarMensagemEquipe(compra.id, `${canal.id}/${mensagemEquipe.id}`);
  return interaction.editReply({
    content: `${tema.emoji.ok} **AVISO ENVIADO — RESERVA #${compra.id}**\nOs números **${listarNumeros(numeros, rifa, 800)}** estão guardados para você. A equipe confere o pagamento e você recebe a confirmação por DM.`,
    components: [],
  });
}

const ERROS_CANCELAR = {
  nao_encontrada: '❌ RESERVA NÃO ENCONTRADA.',
  nao_dono: '❌ ESTA RESERVA NÃO É SUA.',
  paga: `${tema.emoji.ok} ESTE PAGAMENTO JÁ FOI CONFIRMADO: OS NÚMEROS SÃO SEUS.`,
  aguardando: '⏳ VOCÊ JÁ AVISOU QUE PAGOU: AGORA SÓ A ORGANIZAÇÃO PODE CANCELAR ESTA RESERVA.',
  nao_pendente: '⚠️ ESTA RESERVA JÁ FOI ENCERRADA (CANCELADA OU VENCIDA).',
};

async function desistir(interaction, compraId) {
  await interaction.deferUpdate();
  const r = await repo.cancelarCompra(compraId, interaction.user.id, { peloComprador: true });
  if (r.erro) return interaction.editReply({ content: ERROS_CANCELAR[r.erro], components: [] });
  atualizarPublica(interaction.client, r.rifa.id);
  return interaction.editReply({ content: `👋 RESERVA #${r.compra.id} CANCELADA. OS NÚMEROS VOLTARAM PARA A VENDA.`, components: [] });
}

const ERROS_DECISAO = {
  nao_encontrada: '❌ COMPRA NÃO ENCONTRADA.',
  ja_paga: `${tema.emoji.ok} ESTE PAGAMENTO JÁ TINHA SIDO CONFIRMADO.`,
  paga: '⚠️ ESTE PAGAMENTO JÁ FOI CONFIRMADO. DEVOLVER DINHEIRO CONFIRMADO É CANCELAR A RIFA (`/rifa cancelar`).',
  nao_pendente: '⚠️ ESTA RESERVA JÁ FOI ENCERRADA (CANCELADA OU VENCIDA).',
  rifa_fechada: '⚠️ A RIFA JÁ FOI SORTEADA OU CANCELADA: ESTE PAGAMENTO NÃO ENTRA MAIS. DEVOLVA O VALOR NO JOGO.',
  numeros_perdidos: '❌ A RESERVA VENCEU ANTES DO AVISO E PARTE DOS NÚMEROS JÁ FOI PARA OUTRA PESSOA. NADA FOI CONFIRMADO: SE O COMPRADOR PAGOU, DEVOLVA NO JOGO.',
};

async function decidirPagamento(interaction, compraId, confirmar) {
  if (!(await podeConfirmarPagamentos(interaction.member))) {
    return interaction.reply({ content: '❌ SÓ A PRESIDÊNCIA E OS GESTORES DE SOCIAL E EVENTOS OU DO FINANCEIRO CONFEREM PAGAMENTOS DE RIFA.', flags: 64 });
  }
  await interaction.deferUpdate();
  const r = confirmar
    ? await repo.confirmarPagamento(compraId, interaction.user.id)
    : await repo.cancelarCompra(compraId, interaction.user.id, { peloComprador: false });

  if (r.erro) {
    // Resolvido por outra pessoa ou pelo prazo: a mensagem para de oferecer os botões
    if (r.compra) await interaction.editReply({ components: [] }).catch(() => {});
    if (r.erro === 'numeros_perdidos') atualizarPublica(interaction.client, r.rifa.id);
    return interaction.followUp({ content: ERROS_DECISAO[r.erro] ?? '❌ NÃO FOI POSSÍVEL CONCLUIR.', flags: 64 });
  }

  const { compra, rifa, numeros } = r;
  const agora = Math.floor(Date.now() / 1000);
  await interaction.editReply(montarMensagemPagamento({
    compra,
    rifa,
    numeros,
    decisao: confirmar
      ? { texto: `${tema.emoji.ok} Confirmado por <@${interaction.user.id}> <t:${agora}:R>`, cor: tema.cor.primaria }
      : { texto: `❌ Recusado por <@${interaction.user.id}> <t:${agora}:R> — números devolvidos à venda`, cor: tema.cor.perigo },
  }));
  atualizarPublica(interaction.client, rifa.id);

  const lista = listarNumeros(numeros, rifa, 800);
  if (confirmar) {
    await avisarPorDM(interaction.client, compra.discord_id, {
      content: `${tema.emoji.ok} Pagamento confirmado na rifa **${rifa.titulo}**. Seus números: **${lista}**. Boa sorte!`,
    });
    if (R.cruzouLimiar({ totalNumeros: rifa.total_numeros, antes: r.rifaAntes.vendidos, depois: rifa.vendidos, pct: rifa.limiar_sorteio_pct })) {
      await interaction.channel?.send({
        content: `🎯 **RIFA #${rifa.id} — ${rifa.titulo}** atingiu ${rifa.limiar_sorteio_pct}% dos números vendidos. A data do sorteio já pode ser divulgada: \`/rifa marcar-sorteio\`.`,
      }).catch(() => {});
    }
  } else {
    await avisarPorDM(interaction.client, compra.discord_id, {
      content: `❌ A organização não confirmou o pagamento da sua reserva #${compra.id} na rifa **${rifa.titulo}**. Os números ${lista} voltaram para a venda. Se você pagou no jogo, chame a organização.`,
    });
  }

  await registrarLogGestao(interaction.client, {
    titulo: `🎟️ RIFA #${rifa.id} — PAGAMENTO ${confirmar ? 'CONFIRMADO' : 'RECUSADO'}`,
    ator: interaction.user.id,
    cor: confirmar ? tema.cor.primaria : tema.cor.perigo,
    campos: [
      { name: 'COMPRADOR', value: `<@${compra.discord_id}>`, inline: true },
      { name: 'TOTAL', value: formatarDinheiro(compra.total), inline: true },
      { name: 'NÚMEROS', value: lista, inline: false },
    ],
  });
}

async function mostrarMeus(interaction, rifaId) {
  const rifa = await repo.buscarRifa(rifaId);
  if (!rifa) return interaction.reply({ content: '❌ RIFA NÃO ENCONTRADA.', flags: 64 });
  const [bilhetes, abertas] = await Promise.all([
    repo.bilhetesDaPessoa(rifa.id, interaction.user.id),
    repo.comprasAbertasDaPessoa(rifa.id, interaction.user.id),
  ]);
  const pagos = bilhetes.filter(b => b.status === 'PAGO').map(b => b.numero);
  const aguardando = bilhetes.filter(b => b.status === 'RESERVADO' && !b.expira_em).map(b => b.numero);
  const reservados = bilhetes.filter(b => b.status === 'RESERVADO' && b.expira_em).map(b => b.numero);

  const linhas = [`**🎟️ SEUS NÚMEROS — ${rifa.titulo.toUpperCase()}**`];
  if (!bilhetes.length) linhas.push('Você não tem números nesta rifa.');
  if (pagos.length) linhas.push(`${tema.emoji.ok} Pagos (${pagos.length}): **${listarNumeros(pagos, rifa, 600)}**`);
  if (aguardando.length) linhas.push(`⏳ Aguardando a equipe conferir (${aguardando.length}): ${listarNumeros(aguardando, rifa, 400)}`);
  for (const compra of abertas) {
    const daCompra = bilhetes.filter(b => b.compra_id === compra.id).map(b => b.numero);
    linhas.push(`🕐 Reserva #${compra.id}, falta pagar **${formatarDinheiro(compra.total)}** e avisar até <t:${unix(compra.expira_em)}:t>: ${listarNumeros(daCompra, rifa, 300)}`);
  }
  if (!abertas.length && reservados.length) linhas.push(`🕐 Reservados: ${listarNumeros(reservados, rifa, 300)}`);

  if (rifa.status === 'SORTEADA') {
    const numero = R.formatarNumero(rifa.numero_vencedor, rifa.total_numeros);
    linhas.push(rifa.vencedor_id === interaction.user.id ? `🏆 **VOCÊ GANHOU** com o número ${numero}!` : `🏆 Número vencedor: **${numero}**.`);
  } else if (rifa.status === 'CANCELADA') {
    linhas.push('❌ Rifa cancelada. Quem pagou recebe a devolução no jogo pela organização.');
  } else if (pagos.length && rifa.metodo_sorteio === 'SISTEMA') {
    const chance = R.chanceDeGanhar({ meus: pagos.length, vendidos: rifa.vendidos });
    linhas.push(`🎲 Chance se o sorteio fosse agora: **${R.formatarChance(chance)}** (o bot sorteia entre os ${rifa.vendidos} números pagos).`);
  }

  return interaction.reply({
    content: truncar(linhas.join('\n'), 2000),
    components: abertas.map(c => botoesReserva(c.id)),
    flags: 64,
  });
}

registrarModulo('rifa', async interaction => {
  const [, acao, id] = interaction.customId.split(':');
  if (interaction.isModalSubmit()) {
    if (acao === 'numeros') return reservar(interaction, id, 'numeros');
    if (acao === 'quantidade') return reservar(interaction, id, 'quantidade');
    return;
  }
  if (!interaction.isButton()) return;
  if (acao === 'comprar') return abrirCompra(interaction, id);
  if (acao === 'escolher' || acao === 'aleatorio') {
    if (!soSocio(interaction)) return interaction.reply({ content: MSG_SO_SOCIO, flags: 64 });
    return interaction.showModal(acao === 'escolher' ? modalNumeros(id) : modalQuantidade(id));
  }
  if (acao === 'meus') return mostrarMeus(interaction, id);
  if (acao === 'paguei') return avisarPagamento(interaction, id);
  if (acao === 'desistir') return desistir(interaction, id);
  if (acao === 'confirmar') return decidirPagamento(interaction, id, true);
  if (acao === 'recusar') return decidirPagamento(interaction, id, false);
});

module.exports = {};
