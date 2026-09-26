const { agendar } = require('../agendador');
const { registrarLogGestao } = require('../logGestao');
const { arquivarAnexo } = require('../arquivoMidia');
const { parseValor } = require('../financeiro/regras');
const { parseDataHora } = require('../eventos/regras');
const { formatarDinheiro, formatarNumero, truncar } = require('../logsJogo/estatisticas');
const { listaLimitada } = require('../departamentos/regras');
const { avisarPorDM } = require('../eventos/interacoes');
const repo = require('./repositorio');
const R = require('./regras');
const { publicarRifa, atualizarMensagemRifa, fecharMensagemPagamento, linkDaMensagem } = require('./mensagem');
const { canalDePagamentos, canalDeRifas, garantirPainelNoFim } = require('./estrutura');
const { podeGerirRifas, podeVerRifas } = require('./permissoes');
const tema = require('../../tema');

// Ações de gestão da rifa. O /rifa e o painel do canal de rifas chamam as mesmas
// funções: o que muda é só de onde vêm os parâmetros.

const MSG_SEM_GESTAO = '❌ SÓ A PRESIDÊNCIA OU O GESTOR DE SOCIAL E EVENTOS GERE AS RIFAS.';
const MSG_NAO_ENCONTRADA = '❌ RIFA NÃO ENCONTRADA.';
const unix = d => Math.floor(new Date(d).getTime() / 1000);
const atualizarPublica = (client, rifaId) => atualizarMensagemRifa(client, rifaId)
  .catch(err => console.error('[rifas] Erro ao atualizar mensagem:', err));

// d: { titulo, premio, preco (texto), numeros, descricao, custoPremio (texto), limite, sorteio, naoVendido, encerra (texto), anexo }
async function criar(interaction, d) {
  if (!(await podeGerirRifas(interaction.member))) return interaction.reply({ content: MSG_SEM_GESTAO, flags: 64 });

  const canal = (await canalDeRifas(interaction.client)) ?? (interaction.channel?.isTextBased() ? interaction.channel : null);
  if (!canal) return interaction.reply({ content: '❌ NÃO ACHEI O CANAL DAS RIFAS. RODE `/rifa setup` (ADMINISTRADOR) OU USE UM CANAL DE TEXTO.', flags: 64 });

  const preco = parseValor(d.preco);
  const totalNumeros = d.numeros;
  const custoPremio = d.custoPremio ? parseValor(d.custoPremio) : null;
  if (d.custoPremio && custoPremio == null) return interaction.reply({ content: '❌ CUSTO DO PRÊMIO INVÁLIDO.', flags: 64 });
  if (!Number.isInteger(totalNumeros)) return interaction.reply({ content: '❌ QUANTIDADE DE NÚMEROS INVÁLIDA.', flags: 64 });
  const limitePorPessoa = d.limite ?? R.limitePadrao(totalNumeros);
  const validacao = R.validarCriacao({ totalNumeros, preco, limitePorPessoa });
  if (!validacao.ok) return interaction.reply({ content: validacao.mensagem, flags: 64 });
  const encerraEm = d.encerra ? parseDataHora(d.encerra) : null;
  if (d.encerra && !encerraEm) return interaction.reply({ content: '❌ DATA DE ENCERRAMENTO INVÁLIDA. USE `DD/MM HH:MM` (EX.: `30/09 22:00`).', flags: 64 });
  if (encerraEm && encerraEm.getTime() <= Date.now()) return interaction.reply({ content: '❌ A DATA DE ENCERRAMENTO JÁ PASSOU.', flags: 64 });

  await interaction.deferReply({ flags: 64 });
  let imagemRef = null;
  if (d.anexo) {
    try {
      imagemRef = (await arquivarAnexo(interaction.client, d.anexo, `🎟️ Prêmio da rifa: ${d.titulo}`)).ref;
    } catch (err) {
      return interaction.editReply({ content: `❌ ${String(err.message).toUpperCase()}` });
    }
  }

  const metodo = d.sorteio ?? 'SISTEMA';
  // Commit-reveal: o hash sai na mensagem antes do primeiro número vendido
  const compromisso = metodo === 'SISTEMA' ? R.gerarCompromisso() : null;
  const rifa = await repo.criarRifa({
    titulo: d.titulo,
    descricao: d.descricao ?? null,
    premio: d.premio,
    custoPremio,
    imagemRef,
    preco,
    totalNumeros,
    limitePorPessoa,
    metodoSorteio: metodo,
    regraNaoVendido: d.naoVendido ?? 'PROXIMO_VENDIDO',
    compromissoHash: compromisso?.hash ?? null,
    semente: compromisso?.semente ?? null,
    encerraEm,
    canalId: canal.id,
    criadoPorId: interaction.user.id,
  });

  try {
    await publicarRifa(interaction.client, rifa);
  } catch (err) {
    console.error('[rifas] Erro ao publicar rifa:', err);
    await repo.cancelarRifa(rifa.id, 'Falha ao publicar a mensagem da rifa', interaction.client.user.id).catch(() => {});
    return interaction.editReply({ content: '❌ NÃO CONSEGUI PUBLICAR A RIFA NO CANAL (CONFIRA AS PERMISSÕES DO BOT). NADA FOI VENDIDO.' });
  }
  if (encerraEm) await agendar('rifa_encerrar', encerraEm, { rifaId: rifa.id });
  await garantirPainelNoFim(interaction.client);

  const maximo = R.totalCompra(preco, totalNumeros);
  await registrarLogGestao(interaction.client, {
    titulo: `🎟️ RIFA #${rifa.id} CRIADA — ${d.titulo.toUpperCase()}`,
    ator: interaction.user.id,
    campos: [
      { name: 'PRÊMIO', value: truncar(rifa.premio, 1000), inline: false },
      { name: 'NÚMEROS', value: `${formatarNumero(totalNumeros)} × ${formatarDinheiro(preco)}`, inline: true },
      { name: 'SE VENDER TUDO', value: formatarDinheiro(maximo), inline: true },
      { name: 'SORTEIO', value: R.METODOS_SORTEIO[metodo].rotulo, inline: true },
      ...(compromisso ? [{ name: 'COMPROMISSO', value: `\`${compromisso.hash}\``, inline: false }] : []),
    ],
  });

  const semCanal = !(await canalDePagamentos(interaction.client));
  return interaction.editReply({
    content: [
      `🦅 RIFA #${rifa.id} PUBLICADA EM <#${canal.id}>.`,
      `Se vender tudo: **${formatarDinheiro(maximo)}**${custoPremio != null ? ` · prêmio ${formatarDinheiro(custoPremio)} · sobra **${formatarDinheiro(R.resultadoRifa({ arrecadado: maximo, custoPremio }).liquido)}**` : ''}. Limite de ${limitePorPessoa} número${limitePorPessoa !== 1 ? 's' : ''} por pessoa.`,
      compromisso
        ? `Compromisso publicado: \`${compromisso.hash}\`. A semente fica guardada no bot e só aparece no sorteio.`
        : 'Sorteio ao vivo: depois de encerrar, registre com `/rifa sortear` informando o número e a evidência.',
      semCanal ? '⚠️ Falta o canal onde a equipe confere os pagamentos: rode `/rifa setup` (administrador).' : null,
    ].filter(Boolean).join('\n'),
  });
}

async function lista(interaction) {
  await interaction.deferReply({ flags: 64 });
  const rifas = await repo.listarRifas({ status: ['ABERTA', 'ENCERRADA'], limite: 15 });
  const linhas = rifas.map(r => {
    const link = linkDaMensagem(r);
    const prazo = r.status === 'ABERTA' && r.encerra_em ? ` · até <t:${unix(r.encerra_em)}:f>` : '';
    return `${R.STATUS_RIFA[r.status].emoji} **#${r.id} ${link ? `[${r.titulo}](${link})` : r.titulo}** · ${formatarNumero(r.vendidos)}/${formatarNumero(r.total_numeros)} vendidos${prazo}`;
  });
  return interaction.editReply({
    embeds: [{ color: tema.cor.primaria, title: '🎟️ RIFAS EM ANDAMENTO', description: truncar(linhas.join('\n') || '*Nenhuma rifa em andamento.*', 4096) }],
  });
}

async function encerrar(interaction, id) {
  if (!(await podeGerirRifas(interaction.member))) return interaction.reply({ content: MSG_SEM_GESTAO, flags: 64 });
  await interaction.deferReply({ flags: 64 });
  const rifa = await repo.encerrarRifa(id);
  if (!rifa) return interaction.editReply({ content: '❌ RIFA NÃO ENCONTRADA OU JÁ SEM VENDAS ABERTAS.' });
  await atualizarPublica(interaction.client, rifa.id);
  const pendentes = await repo.comprasPendentes(rifa.id);
  await registrarLogGestao(interaction.client, {
    titulo: `${tema.emoji.alerta} RIFA #${rifa.id} ENCERRADA — ${rifa.titulo.toUpperCase()}`,
    ator: interaction.user.id,
    campos: [
      { name: 'VENDIDOS', value: `${rifa.vendidos}/${rifa.total_numeros}`, inline: true },
      { name: 'ARRECADADO', value: formatarDinheiro(rifa.arrecadado), inline: true },
    ],
  });
  return interaction.editReply({
    content: `${tema.emoji.alerta} VENDAS DA RIFA #${rifa.id} ENCERRADAS. ${pendentes.length
      ? `Há ${pendentes.length} compra${pendentes.length !== 1 ? 's' : ''} aguardando pagamento ou conferência: resolva antes de sortear.`
      : 'Já dá para sortear.'}`,
  });
}

// d: { numero, link, anexo } (só no sorteio ao vivo)
async function sortear(interaction, id, d = {}) {
  if (!(await podeGerirRifas(interaction.member))) return interaction.reply({ content: MSG_SEM_GESTAO, flags: 64 });
  await interaction.deferReply({ flags: 64 });
  const rifa = await repo.buscarRifa(id);
  if (!rifa) return interaction.editReply({ content: MSG_NAO_ENCONTRADA });

  let evidenciaRef = null;
  if (d.anexo && rifa.metodo_sorteio === 'MANUAL') {
    try {
      evidenciaRef = (await arquivarAnexo(interaction.client, d.anexo, `🏆 Evidência do sorteio da rifa #${rifa.id}`)).ref;
    } catch (err) {
      return interaction.editReply({ content: `❌ ${String(err.message).toUpperCase()}` });
    }
  }

  const r = await repo.sortear(rifa.id, {
    numeroManual: d.numero ?? null,
    evidencia: d.link ?? null,
    evidenciaRef,
    porId: interaction.user.id,
  });
  if (r.bloqueios) {
    return interaction.editReply({ content: `⛔ **AINDA NÃO DÁ PARA SORTEAR A RIFA #${rifa.id}:**\n${r.bloqueios.map(b => `• ${b}`).join('\n')}` });
  }
  if (r.erro === 'repetir') {
    return interaction.editReply({
      content: `🔁 O NÚMERO ${R.formatarNumero(r.numeroSorteado, rifa.total_numeros)} NÃO FOI VENDIDO E A REGRA DESTA RIFA É REPETIR O SORTEIO. SORTEIE DE NOVO E REGISTRE O NOVO NÚMERO. NADA FOI GRAVADO.`,
    });
  }
  if (r.erro) return interaction.editReply({ content: MSG_NAO_ENCONTRADA });

  const sorteada = r.rifa;
  const numero = R.formatarNumero(sorteada.numero_vencedor, sorteada.total_numeros);
  await atualizarPublica(interaction.client, sorteada.id);

  // Resultado público com o arquivo que permite a qualquer um conferir
  const canal = await interaction.client.channels.fetch(sorteada.canal_id).catch(() => null);
  if (canal?.isTextBased()) {
    await canal.send({
      content: `🏆 **RESULTADO DA RIFA #${sorteada.id} — ${sorteada.titulo.toUpperCase()}**\nNúmero **${numero}** · <@${sorteada.vencedor_id}>! 🦅`,
      files: [{ attachment: Buffer.from(R.textoAuditoria(sorteada, r.pagos), 'utf-8'), name: `rifa-${sorteada.id}-auditoria.txt` }],
      allowedMentions: { users: [sorteada.vencedor_id] },
      ...(sorteada.message_id ? { reply: { messageReference: sorteada.message_id, failIfNotExists: false } } : {}),
    }).catch(err => console.error('[rifas] Erro ao anunciar resultado:', err));
  }
  await avisarPorDM(interaction.client, sorteada.vencedor_id, {
    content: `🏆 Você ganhou a rifa **${sorteada.titulo}** com o número **${numero}**! Prêmio: ${sorteada.premio}. A organização vai falar com você para a entrega.`,
  });
  await registrarLogGestao(interaction.client, {
    titulo: `🏆 RIFA #${sorteada.id} SORTEADA — ${sorteada.titulo.toUpperCase()}`,
    ator: interaction.user.id,
    cor: tema.cor.aviso,
    campos: [
      { name: 'NÚMERO', value: numero, inline: true },
      { name: 'VENCEDOR', value: `<@${sorteada.vencedor_id}>`, inline: true },
      { name: 'MÉTODO', value: R.METODOS_SORTEIO[sorteada.metodo_sorteio].rotulo, inline: true },
      { name: 'ARRECADADO', value: formatarDinheiro(sorteada.arrecadado), inline: true },
      { name: 'HASH DA LISTA', value: `\`${sorteada.hash_lista_final}\``, inline: false },
    ],
  });
  return interaction.editReply({ content: `🏆 RIFA #${sorteada.id} SORTEADA: NÚMERO **${numero}** — <@${sorteada.vencedor_id}>. O RESULTADO FOI PUBLICADO NO CANAL DA RIFA COM O ARQUIVO DE AUDITORIA.` });
}

async function cancelar(interaction, id, motivo) {
  if (!(await podeGerirRifas(interaction.member))) return interaction.reply({ content: MSG_SEM_GESTAO, flags: 64 });
  await interaction.deferReply({ flags: 64 });
  const r = await repo.cancelarRifa(id, motivo, interaction.user.id);
  if (r.erro === 'fechada') return interaction.editReply({ content: '❌ ESTA RIFA JÁ FOI SORTEADA OU CANCELADA.' });
  if (r.erro) return interaction.editReply({ content: MSG_NAO_ENCONTRADA });

  const { rifa, pendentes, pagantes } = r;
  await atualizarPublica(interaction.client, rifa.id);
  for (const compra of pendentes) {
    await fecharMensagemPagamento(interaction.client, compra.mensagem_equipe_ref, { texto: '❌ Rifa cancelada antes da conferência', cor: tema.cor.perigo }).catch(() => {});
    // Quem avisou que pagou pode ter pago de verdade: precisa saber que a devolução é com a organização
    if (compra.status === 'AGUARDANDO') {
      await avisarPorDM(interaction.client, compra.discord_id, {
        content: `❌ A rifa **${rifa.titulo}** foi cancelada antes de conferir o seu pagamento (reserva #${compra.id}). Motivo: ${motivo}. Se você pagou no jogo, a organização devolve ${formatarDinheiro(compra.total)}.`,
      });
    }
  }
  for (const p of pagantes) {
    await avisarPorDM(interaction.client, p.discord_id, {
      content: `❌ A rifa **${rifa.titulo}** foi cancelada. Motivo: ${motivo}. A organização devolve ${formatarDinheiro(p.total)} a você no jogo.`,
    });
  }
  await registrarLogGestao(interaction.client, {
    titulo: `❌ RIFA #${rifa.id} CANCELADA — ${rifa.titulo.toUpperCase()}`,
    ator: interaction.user.id,
    cor: tema.cor.perigo,
    campos: [
      { name: 'MOTIVO', value: truncar(motivo, 1000), inline: false },
      { name: 'A DEVOLVER NO JOGO', value: formatarDinheiro(rifa.arrecadado), inline: true },
      { name: 'COMPRADORES PAGOS', value: String(pagantes.length), inline: true },
    ],
  });
  const devolucoes = listaLimitada(pagantes.map(p => `<@${p.discord_id}> — ${formatarDinheiro(p.total)}`), 1500);
  return interaction.editReply({
    content: [
      `❌ RIFA #${rifa.id} CANCELADA. TODOS OS COMPRADORES FORAM AVISADOS POR DM.`,
      pagantes.length
        ? `Devolver **${formatarDinheiro(rifa.arrecadado)}** no jogo (já lançado como despesa no financeiro):\n${devolucoes}`
        : 'Nenhum pagamento tinha sido confirmado: não há nada a devolver.',
    ].join('\n'),
    allowedMentions: { parse: [] },
  });
}

async function relatorio(interaction, id) {
  if (!(await podeVerRifas(interaction.member))) {
    return interaction.reply({ content: '❌ SÓ A LIDERANÇA E A EQUIPE DAS RIFAS ACOMPANHAM O RELATÓRIO.', flags: 64 });
  }
  await interaction.deferReply({ flags: 64 });
  const rifa = await repo.buscarRifa(id);
  if (!rifa) return interaction.editReply({ content: MSG_NAO_ENCONTRADA });

  const [reservados, pendentes, compradores] = await Promise.all([
    repo.contarReservados(rifa.id),
    repo.comprasPendentes(rifa.id),
    repo.maioresCompradores(rifa.id, 10),
  ]);
  const arrecadado = Number(rifa.arrecadado);
  const custoPremio = rifa.custo_premio == null ? null : Number(rifa.custo_premio);
  const resultado = R.resultadoRifa({ arrecadado, custoPremio });
  const progresso = R.progressoVenda({ totalNumeros: rifa.total_numeros, vendidos: rifa.vendidos });
  const limiar = R.progressoLimiar({ totalNumeros: rifa.total_numeros, vendidos: rifa.vendidos, pct: rifa.limiar_sorteio_pct });
  const link = linkDaMensagem(rifa);

  return interaction.editReply({
    embeds: [{
      color: tema.cor.primaria,
      title: truncar(`📋 RIFA #${rifa.id} — ${rifa.titulo.toUpperCase()}`, 256),
      description: `${R.STATUS_RIFA[rifa.status].emoji} ${R.STATUS_RIFA[rifa.status].rotulo}${link ? ` · [ver rifa](${link})` : ''}`,
      fields: [
        { name: 'VENDIDOS', value: `${formatarNumero(rifa.vendidos)}/${formatarNumero(rifa.total_numeros)} (${progresso.percentual}%)`, inline: true },
        { name: 'RESERVADOS AGORA', value: formatarNumero(reservados), inline: true },
        { name: `META DE ${limiar.pct}%`, value: limiar.atingido ? 'Atingida' : `Faltam ${formatarNumero(limiar.faltam)} números`, inline: true },
        { name: 'ARRECADADO', value: formatarDinheiro(arrecadado), inline: true },
        { name: 'CUSTO DO PRÊMIO', value: custoPremio == null ? 'Não informado' : formatarDinheiro(custoPremio), inline: true },
        { name: 'SOBRA', value: custoPremio == null ? '—' : formatarDinheiro(resultado.liquido), inline: true },
        {
          name: `PAGAMENTOS PENDENTES (${pendentes.length})`,
          value: listaLimitada(pendentes.map(c => `#${c.id} <@${c.discord_id}> · ${formatarDinheiro(c.total)} · ${c.status === 'AGUARDANDO'
            ? 'aguardando conferência'
            : `reserva até <t:${unix(c.expira_em)}:t>`}`), 1000) || '*Nenhum.*',
          inline: false,
        },
        {
          name: 'MAIORES COMPRADORES',
          value: listaLimitada(compradores.map((c, i) => `${i + 1}. <@${c.discord_id}> — ${c.numeros} número${c.numeros !== 1 ? 's' : ''} · ${formatarDinheiro(c.total)}`), 1000) || '*Nenhuma compra confirmada.*',
          inline: false,
        },
      ],
    }],
    allowedMentions: { parse: [] },
  });
}

module.exports = { criar, lista, encerrar, sortear, cancelar, relatorio, MSG_SEM_GESTAO };
