const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { registrarModulo } = require('../modulos');
const { registrarLogGestao } = require('../logGestao');
const { agendar } = require('../agendador');
const tema = require('../../tema');
const { podeGerirRifas } = require('../rifas/permissoes');
const { nomeSeguro } = require('../logsJogo/painelFormato');
const repo = require('./repositorio');
const R = require('./regras');
const M = require('./mensagem');
const { canalDeSorteios, canalDeHistorico, garantirPainelNoFim } = require('./estrutura');
const { participantesDoDia, idsOnlineAgora } = require('./participantes');

// customId: sorteio:novo · sorteio:m_novo (modal) · sorteio:<acao>:<id>[:<extra>]
// Ações de condução (sortear, ressortear, prêmios, lista, concluir, cancelar,
// entrega) só para a presidência e o gestor de Social e Eventos, conferido em
// CADA handler. Ver participantes e auditoria é livre.

const SEM_PERMISSAO = '❌ SÓ A PRESIDÊNCIA OU O GESTOR DE SOCIAL E EVENTOS CONDUZ OS SORTEIOS.';
const SEM_CANAL = '❌ O CANAL DE SORTEIOS NÃO EXISTE. USE `/sorteio estrutura`.';
const DIAS_RECENTES = 30;
const LEMBRETE_ENTREGA_MS = 24 * 60 * 60 * 1000;
const ERROS = {
  nao_encontrado: '⚠️ SORTEIO NÃO ENCONTRADO.',
  fechado: '⚠️ ESTE SORTEIO JÁ FOI ENCERRADO.',
  sem_premio: '⚠️ NÃO HÁ PRÊMIO PENDENTE. CADASTRE PRÊMIOS EM ➕ PRÊMIOS.',
  sem_numeros: '⚠️ ACABARAM OS NÚMEROS: HÁ MAIS PRÊMIOS/RESSORTEIOS DO QUE NÚMEROS. REMOVA PRÊMIOS.',
  ja_sorteado: '⚠️ ESSE PRÊMIO JÁ FOI SORTEADO E NÃO PODE MUDAR.',
  ja_sorteou: '⚠️ JÁ HOUVE SORTEIO: A LISTA NÃO MUDA MAIS.',
  nao_sorteado: '⚠️ ESSE PRÊMIO AINDA NÃO FOI SORTEADO.',
  ja_entregue: '⚠️ ESSE PRÊMIO JÁ FOI ENTREGUE.',
};

const responder = (interaction, content) => interaction.reply({ content, flags: 64 });

async function exigirGestao(interaction) {
  if (await podeGerirRifas(interaction.member)) return true;
  await responder(interaction, SEM_PERMISSAO);
  return false;
}

function campoModal(id, rotulo, { estilo = TextInputStyle.Short, obrigatorio = true, valor, max } = {}) {
  const c = new TextInputBuilder().setCustomId(id).setLabel(rotulo).setStyle(estilo).setRequired(obrigatorio);
  if (valor) c.setValue(valor);
  if (max) c.setMaxLength(max);
  return new ActionRowBuilder().addComponents(c);
}

// Reedita a mensagem viva. Se ela foi apagada no canal, publica de novo (o
// sorteio não pode "sumir" do canal só porque alguém apagou a mensagem).
async function atualizarMensagem(client, sorteioId) {
  const sorteio = await repo.buscar(sorteioId);
  if (!sorteio?.canal_id) return null;
  const conteudo = M.montarSorteio(sorteio, await repo.premios(sorteioId), await repo.participantes(sorteioId));
  try {
    const canal = await client.channels.fetch(sorteio.canal_id);
    const mensagem = sorteio.message_id ? await canal.messages.fetch(sorteio.message_id).catch(() => null) : null;
    if (mensagem) {
      await mensagem.edit(conteudo);
    } else if (sorteio.status === 'ABERTO') {
      const nova = await canal.send(conteudo);
      await repo.gravarMensagem(sorteioId, { canalId: canal.id, messageId: nova.id });
      await garantirPainelNoFim(client);
    }
  } catch (err) {
    console.error(`[sorteios] não consegui atualizar a mensagem do sorteio #${sorteioId}:`, err.message);
  }
  return sorteio;
}

async function atualizarHistorico(client, sorteioId) {
  const sorteio = await repo.buscar(sorteioId);
  if (!sorteio?.historico_canal_id || !sorteio.historico_message_id) return;
  try {
    const canal = await client.channels.fetch(sorteio.historico_canal_id);
    const mensagem = await canal.messages.fetch(sorteio.historico_message_id);
    await mensagem.edit(M.montarHistorico(sorteio, await repo.premios(sorteioId), await repo.participantes(sorteioId)));
  } catch (err) {
    console.error(`[sorteios] não consegui atualizar o histórico do sorteio #${sorteioId}:`, err.message);
  }
}

// ── Criar ───────────────────────────────────────────────────────────────────
async function abrirNovo(interaction) {
  if (!(await exigirGestao(interaction))) return;
  return interaction.showModal(new ModalBuilder().setCustomId('sorteio:m_novo').setTitle('NOVO SORTEIO').addComponents(
    campoModal('titulo', 'TÍTULO (EX.: PISTA DE SÁBADO)', { max: R.TITULO_MAX }),
    campoModal('dia', 'DIA DO REGISTRO (AAAA-MM-DD; VAZIO = HOJE)', { obrigatorio: false, max: 10 }),
    campoModal('minutos', 'MINUTOS ONLINE MÍNIMOS (VAZIO = TODOS)', { obrigatorio: false, max: 4 }),
    campoModal('numeros', 'SÓ NÚMEROS: SORTEAR DE 1 ATÉ (VAZIO=REGISTRO)', { obrigatorio: false, max: 4 }),
    campoModal('premios', 'PRÊMIOS (UM POR LINHA, EM ORDEM)', { estilo: TextInputStyle.Paragraph, obrigatorio: false, max: 2000 })
  ));
}

async function criarSorteio(interaction) {
  if (!(await exigirGestao(interaction))) return;
  const campo = k => interaction.fields.getTextInputValue(k);
  const titulo = R.validarTitulo(campo('titulo'));
  if (!titulo.ok) return responder(interaction, titulo.mensagem);
  const numeros = R.parseNumeros(campo('numeros'));
  if (!numeros.ok) return responder(interaction, numeros.mensagem);
  const minutos = R.parseMinutos(campo('minutos'));
  if (!minutos.ok) return responder(interaction, minutos.mensagem);
  const lista = R.parsePremios(campo('premios'));
  if (!lista.ok) return responder(interaction, lista.mensagem);
  if (lista.premios.length > R.PREMIOS_MAX) return responder(interaction, `❌ NO MÁXIMO ${R.PREMIOS_MAX} PRÊMIOS POR SORTEIO.`);
  const dia = numeros.numeros ? null : R.parseDia(campo('dia'));
  if (!numeros.numeros && !dia) return responder(interaction, '❌ DIA INVÁLIDO. USE AAAA-MM-DD OU DD/MM.');

  const canal = await canalDeSorteios(interaction.client);
  if (!canal) return responder(interaction, SEM_CANAL);
  await interaction.deferReply({ flags: 64 });

  let elegiveis = { participantes: [], excluidosMinimo: 0, excluidosRecentes: 0 };
  if (!numeros.numeros) {
    elegiveis = await participantesDoDia(dia, interaction.client, { minMinutos: minutos.minutos });
    if (!elegiveis.participantes.length) {
      const motivo = elegiveis.excluidosMinimo ? ` (${elegiveis.excluidosMinimo} ficaram abaixo de ${minutos.minutos} min)` : '';
      return interaction.editReply({ content: `⚠️ NÃO HÁ JOGADORES ELEGÍVEIS NO REGISTRO DIÁRIO DE **${dia.split('-').reverse().join('/')}**${motivo}. CONFIRA O DIA OU USE O CAMPO DE NÚMEROS.` });
    }
  }
  const total = numeros.numeros ?? elegiveis.participantes.length;
  if (lista.premios.length > total) {
    return interaction.editReply({ content: `❌ SÃO ${lista.premios.length} PRÊMIOS PARA ${total} NÚMEROS: NÃO DÁ PARA SORTEAR SEM REPETIR.` });
  }

  const sorteio = await repo.criar({
    titulo: titulo.titulo, origem: numeros.numeros ? 'NUMEROS' : 'REGISTRO', dia, totalNumeros: total,
    criadoPor: interaction.user.id, participantes: elegiveis.participantes, premios: lista.premios,
    minMinutos: numeros.numeros ? null : minutos.minutos,
    excluidosMinimo: elegiveis.excluidosMinimo, excluidosRecentes: elegiveis.excluidosRecentes,
  });
  try {
    const mensagem = await canal.send(M.montarSorteio(sorteio, await repo.premios(sorteio.id), await repo.participantes(sorteio.id)));
    await repo.gravarMensagem(sorteio.id, { canalId: canal.id, messageId: mensagem.id });
  } catch (err) {
    // "resolvido" só depois da ação ter funcionado: sem mensagem publicada, o sorteio não fica aberto
    await repo.cancelar(sorteio.id);
    console.error('[sorteios] erro ao publicar:', err.message);
    return interaction.editReply({ content: '❌ NÃO CONSEGUI PUBLICAR O SORTEIO. TENTE DE NOVO.' });
  }
  await garantirPainelNoFim(interaction.client);
  const fora = elegiveis.excluidosMinimo ? ` (${elegiveis.excluidosMinimo} FORA POR TEMPO MÍNIMO)` : '';
  return interaction.editReply({ content: `${tema.emoji.ok} SORTEIO **#${sorteio.id}** CRIADO EM <#${canal.id}> COM ${total} NÚMEROS${fora}.` });
}

// ── Sortear e ressortear ────────────────────────────────────────────────────
// Ao lado de quem ganhou: está com o jogo aberto agora? (ajuda a decidir na hora
// se vale ressortear; nunca muda o resultado)
function linhaResultado(premio, numero, participante, online) {
  const estado = participante && online
    ? ` ${online.has(String(participante.id_jogo)) ? `${tema.emoji.ativo} online agora` : `${tema.emoji.inativo} fora do jogo agora`}`
    : '';
  const dono = participante
    ? `**${nomeSeguro(participante.nome)}** \`${participante.id_jogo}\`${participante.discord_id ? ` <@${participante.discord_id}>` : ''}${estado}`
    : '';
  return `🎯 **${premio.descricao}** → **Nº ${numero}**${dono ? ` · ${dono}` : ''}`;
}

async function sortear(interaction, sorteioId, todos) {
  if (!(await exigirGestao(interaction))) return;
  await interaction.deferUpdate();
  const online = await idsOnlineAgora();
  const linhas = [];
  const usuarios = new Set();
  let erro = null;
  let restantes = null;
  for (;;) {
    const r = await repo.sortearProximo(sorteioId, interaction.user.id);
    if (r.erro) { erro = r.erro; break; }
    restantes = r.restantes;
    const participante = await repo.participantePorNumero(sorteioId, r.numero);
    if (participante?.discord_id) usuarios.add(participante.discord_id);
    linhas.push(linhaResultado(r.premio, r.numero, participante, online));
    if (!todos) break;
  }
  if (linhas.length) {
    await interaction.channel.send({
      content: `🎲 **SORTEIO #${sorteioId}**\n${linhas.join('\n')}\n_Restam ${restantes} número(s) no globo._`.slice(0, 2000),
      allowedMentions: { users: [...usuarios] },
    });
  }
  await atualizarMensagem(interaction.client, sorteioId);
  if (erro && (!linhas.length || erro === 'sem_numeros')) {
    return interaction.followUp({ content: ERROS[erro] ?? '⚠️ NÃO FOI POSSÍVEL SORTEAR.', flags: 64 });
  }
}

async function ressortearPremio(interaction, id) {
  if (!(await exigirGestao(interaction))) return;
  const premioId = interaction.values?.[0];
  const antesPremio = (await repo.premios(id)).find(p => String(p.id) === premioId);
  const antes = antesPremio?.numero != null ? await repo.participantePorNumero(id, antesPremio.numero) : null;
  const r = await repo.ressortear(id, premioId, interaction.user.id);
  if (r.erro) return interaction.update({ content: ERROS[r.erro] ?? '⚠️ NÃO FOI POSSÍVEL RESSORTEAR.', components: [] });
  const participante = await repo.participantePorNumero(id, r.numero);
  const online = await idsOnlineAgora();
  await interaction.channel.send({
    content: `🔁 **RESSORTEIO — SORTEIO #${id}**\nO **Nº ${r.anterior}**${antes ? ` (${nomeSeguro(antes.nome)})` : ''} saiu do prêmio; o número continua queimado.\n`
      + `${linhaResultado(r.premio, r.numero, participante, online)}\n_Restam ${r.restantes} número(s) no globo._`.slice(0, 1900),
    allowedMentions: { users: [participante?.discord_id].filter(Boolean) },
  });
  await atualizarMensagem(interaction.client, id);
  return interaction.update({ content: `${tema.emoji.ok} PRÊMIO RESSORTEADO: NOVO Nº **${r.numero}**.`, components: [] });
}

// ── Prêmios (botão → select → modal de 1 campo) ─────────────────────────────
async function abrirAdicionar(interaction, id) {
  if (!(await exigirGestao(interaction))) return;
  return interaction.showModal(new ModalBuilder().setCustomId(`sorteio:m_add:${id}`).setTitle('ADICIONAR PRÊMIOS').addComponents(
    campoModal('premios', 'PRÊMIOS (UM POR LINHA)', { estilo: TextInputStyle.Paragraph, max: 2000 })
  ));
}

async function adicionar(interaction, id) {
  if (!(await exigirGestao(interaction))) return;
  const lista = R.parsePremios(interaction.fields.getTextInputValue('premios'));
  if (!lista.ok) return responder(interaction, lista.mensagem);
  if (!lista.premios.length) return responder(interaction, '❌ INFORME AO MENOS UM PRÊMIO.');
  const sorteio = await repo.buscar(id);
  if (!sorteio) return responder(interaction, ERROS.nao_encontrado);
  const r = await repo.adicionarPremios(id, lista.premios, Math.min(sorteio.total_numeros, R.PREMIOS_MAX));
  if (r.erro === 'excede') return responder(interaction, `❌ O SORTEIO COMPORTA NO MÁXIMO ${r.limite} PRÊMIOS (NÚMEROS DISPONÍVEIS) E JÁ TEM ${r.atuais}.`);
  if (r.erro) return responder(interaction, ERROS[r.erro]);
  await atualizarMensagem(interaction.client, id);
  return responder(interaction, `${tema.emoji.ok} ${r.adicionados} PRÊMIO(S) ADICIONADO(S).`);
}

// Abre um select de prêmios: pendentes (editar/remover), sorteados (ressortear) ou sorteados sem entrega
async function escolherPremio(interaction, id, acao, texto, { sorteados = false, semEntrega = false } = {}) {
  if (!(await exigirGestao(interaction))) return;
  const sorteio = await repo.buscar(id);
  if (!sorteio) return responder(interaction, ERROS.nao_encontrado);
  let premios = await repo.premios(id);
  if (semEntrega) premios = premios.filter(p => !p.entregue_em);
  if (!premios.some(p => (p.numero != null) === sorteados)) {
    return responder(interaction, sorteados ? '⚠️ NÃO HÁ PRÊMIO SORTEADO.' : '⚠️ NÃO HÁ PRÊMIO PENDENTE.');
  }
  return interaction.reply(M.montarSelectPremios(acao, sorteio, premios, texto, { sorteados, participantes: await repo.participantes(id) }));
}

async function abrirEditar(interaction, id) {
  if (!(await exigirGestao(interaction))) return;
  const premio = (await repo.premios(id)).find(p => String(p.id) === interaction.values?.[0]);
  if (!premio || premio.numero != null) return responder(interaction, ERROS.ja_sorteado);
  return interaction.showModal(new ModalBuilder().setCustomId(`sorteio:m_edit:${id}:${premio.id}`).setTitle('EDITAR PRÊMIO').addComponents(
    campoModal('descricao', 'DESCRIÇÃO DO PRÊMIO', { valor: premio.descricao, max: R.PREMIO_MAX })
  ));
}

async function editar(interaction, id, premioId) {
  if (!(await exigirGestao(interaction))) return;
  const lista = R.parsePremios(interaction.fields.getTextInputValue('descricao'));
  if (!lista.ok) return responder(interaction, lista.mensagem);
  if (lista.premios.length !== 1) return responder(interaction, '❌ INFORME UMA DESCRIÇÃO (UMA LINHA).');
  const r = await repo.editarPremio(id, premioId, lista.premios[0]);
  if (r.erro) return responder(interaction, ERROS[r.erro]);
  await atualizarMensagem(interaction.client, id);
  return responder(interaction, `${tema.emoji.ok} PRÊMIO ATUALIZADO.`);
}

async function remover(interaction, id) {
  if (!(await exigirGestao(interaction))) return;
  const r = await repo.removerPremio(id, interaction.values?.[0]);
  if (r.erro) return responder(interaction, ERROS[r.erro]);
  await atualizarMensagem(interaction.client, id);
  return interaction.update({ content: `${tema.emoji.ok} PRÊMIO REMOVIDO.`, components: [] });
}

// ── Lista, auditoria, elegibilidade ─────────────────────────────────────────
async function verLista(interaction, id, pagina, atualizar) {
  const sorteio = await repo.buscar(id);
  if (!sorteio) return responder(interaction, ERROS.nao_encontrado);
  const conteudo = M.montarLista(sorteio, await repo.participantes(id), pagina);
  return atualizar ? interaction.update(conteudo) : interaction.reply({ ...conteudo, flags: 64 });
}

async function verAuditoria(interaction, id) {
  const sorteio = await repo.buscar(id);
  if (!sorteio) return responder(interaction, ERROS.nao_encontrado);
  const conteudo = M.montarAuditoria(sorteio, await repo.premios(id), await repo.participantes(id), await repo.sorteadas(id));
  return interaction.reply({ ...conteudo, flags: 64 });
}

// Relê o registro do dia aplicando as regras guardadas (e, se pedido, ligando/desligando "recentes")
async function reaplicarLista(interaction, id, { alternarRecentes = false } = {}) {
  if (!(await exigirGestao(interaction))) return;
  const sorteio = await repo.buscar(id);
  if (!sorteio) return responder(interaction, ERROS.nao_encontrado);
  if (sorteio.origem !== 'REGISTRO') return responder(interaction, '⚠️ ESTE SORTEIO É SÓ DE NÚMEROS.');
  await interaction.deferReply({ flags: 64 });
  const excluirDias = alternarRecentes ? (sorteio.excluir_dias ? null : DIAS_RECENTES) : sorteio.excluir_dias;
  const novos = await participantesDoDia(sorteio.dia, interaction.client, { minMinutos: sorteio.min_minutos, excluirDias });
  if (!novos.participantes.length) return interaction.editReply({ content: '⚠️ NENHUM JOGADOR ELEGÍVEL COM ESSAS REGRAS: A LISTA FICOU COMO ESTAVA.' });
  const premios = await repo.premios(id);
  if (premios.length > novos.participantes.length) {
    return interaction.editReply({ content: `⚠️ SERIAM ${novos.participantes.length} NÚMEROS PARA ${premios.length} PRÊMIOS: REMOVA PRÊMIOS ANTES. A LISTA FICOU COMO ESTAVA.` });
  }
  const r = await repo.substituirParticipantes(id, novos.participantes, {
    excluirDias, excluidosMinimo: novos.excluidosMinimo, excluidosRecentes: novos.excluidosRecentes,
  });
  if (r.erro) return interaction.editReply({ content: ERROS[r.erro] });
  await atualizarMensagem(interaction.client, id);
  const extra = alternarRecentes ? (excluirDias ? ` GANHADORES DOS ÚLTIMOS ${DIAS_RECENTES} DIAS FICARAM DE FORA (${novos.excluidosRecentes}).` : ' GANHADORES RECENTES VOLTARAM À LISTA.') : '';
  return interaction.editReply({ content: `${tema.emoji.ok} LISTA ATUALIZADA: **${r.total}** JOGADORES ELEGÍVEIS.${extra}` });
}

// ── Concluir, entrega, cancelar ─────────────────────────────────────────────
// DM para cada ganhador com Discord ligado; só marca "notificado" se a DM chegou
async function notificarGanhadores(guild, sorteio, premios, participantes) {
  const porNumero = new Map(participantes.map(p => [p.numero, p]));
  const resultado = { avisados: 0, semDiscord: 0, falhas: 0 };
  for (const premio of premios) {
    const ganhador = porNumero.get(premio.numero);
    if (!ganhador?.discord_id) { resultado.semDiscord++; continue; }
    try {
      const membro = await guild.members.fetch(ganhador.discord_id);
      await membro.send({ content: `🎉 Você ganhou no sorteio **${sorteio.titulo}**: **${premio.descricao}** (Nº ${premio.numero}). Procure a liderança para receber.` });
      await repo.marcarNotificado(premio.id);
      resultado.avisados++;
    } catch {
      resultado.falhas++; // DM fechada ou saiu do servidor
    }
  }
  return resultado;
}

async function concluir(interaction, id) {
  if (!(await exigirGestao(interaction))) return;
  await interaction.deferReply({ flags: 64 });
  const r = await repo.concluir(id);
  if (r.erro === 'pendentes') return interaction.editReply({ content: `⚠️ AINDA HÁ ${r.pendentes} PRÊMIO(S) SEM SORTEAR. SORTEIE OU REMOVA ANTES DE CONCLUIR.` });
  if (r.erro) return interaction.editReply({ content: ERROS[r.erro] });

  const sorteio = await repo.buscar(id);
  const premios = await repo.premios(id);
  const participantes = await repo.participantes(id);
  const client = interaction.client;

  const canal = await canalDeSorteios(client);
  if (canal) await canal.send(M.montarAnuncio(sorteio, premios, participantes)).catch(err => console.error('[sorteios] anúncio:', err.message));
  const dms = await notificarGanhadores(interaction.guild, sorteio, premios, participantes);

  // Vai para o histórico e sai da lista viva; se o histórico falhar, a mensagem viva fica (sem botões) e a equipe é avisada
  let noHistorico = false;
  const historico = await canalDeHistorico(client);
  if (historico) {
    try {
      const registro = await historico.send(M.montarHistorico(sorteio, premios, participantes));
      await repo.gravarHistorico(id, { canalId: historico.id, messageId: registro.id });
      noHistorico = true;
    } catch (err) {
      console.error('[sorteios] erro ao gravar no histórico:', err.message);
    }
  }
  if (noHistorico && sorteio.canal_id && sorteio.message_id) {
    const c = await client.channels.fetch(sorteio.canal_id).catch(() => null);
    const m = c ? await c.messages.fetch(sorteio.message_id).catch(() => null) : null;
    await m?.delete().catch(() => {});
  } else {
    await atualizarMensagem(client, id);
  }
  // Lembrete se o prêmio ficar parado: sobrevive a reinício (tarefa agendada)
  await agendar('sorteio_lembrar_entrega', new Date(Date.now() + LEMBRETE_ENTREGA_MS), { sorteioId: id }).catch(err => console.error('[sorteios] agendar lembrete:', err.message));
  await registrarLogGestao(client, { titulo: `🎁 SORTEIO #${id} CONCLUÍDO`, ator: interaction.user.id, campos: [{ name: 'TÍTULO', value: sorteio.titulo }, { name: 'PRÊMIOS', value: String(premios.length), inline: true }] });

  const partes = [`${tema.emoji.ok} SORTEIO **#${id}** CONCLUÍDO.`, `DMs: ${dms.avisados} enviada(s)` + (dms.semDiscord ? `, ${dms.semDiscord} sem Discord ligado` : '') + (dms.falhas ? `, ${dms.falhas} com DM fechada` : '') + '.'];
  partes.push(noHistorico ? 'Registrado no histórico (lá você marca a entrega de cada prêmio).' : `${tema.emoji.aviso} O histórico não recebeu o registro (canal ausente ou sem permissão): use \`/sorteio estrutura\`.`);
  return interaction.editReply({ content: partes.join('\n') });
}

async function marcarEntrega(interaction, id) {
  if (!(await exigirGestao(interaction))) return;
  const ok = await repo.marcarEntrega(id, interaction.values?.[0], interaction.user.id);
  if (!ok) return interaction.update({ content: ERROS.ja_entregue, components: [] });
  await atualizarHistorico(interaction.client, id);
  return interaction.update({ content: `${tema.emoji.ok} ENTREGA REGISTRADA.`, components: [] });
}

async function pedirCancelamento(interaction, id) {
  if (!(await exigirGestao(interaction))) return;
  return interaction.reply({
    content: `⚠️ CANCELAR O SORTEIO **#${id}**? OS RESULTADOS JÁ SORTEADOS NÃO VÃO PARA O HISTÓRICO.`,
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sorteio:cancelar_ok:${id}`).setLabel('CONFIRMAR CANCELAMENTO').setStyle(ButtonStyle.Danger)
    )],
    flags: 64,
  });
}

async function cancelar(interaction, id) {
  if (!(await exigirGestao(interaction))) return;
  if (!(await repo.cancelar(id))) return interaction.update({ content: ERROS.fechado, components: [] });
  await atualizarMensagem(interaction.client, id);
  return interaction.update({ content: `${tema.emoji.ok} SORTEIO **#${id}** CANCELADO.`, components: [] });
}

registrarModulo('sorteio', async interaction => {
  const [, acao, idTexto, extra] = interaction.customId.split(':');
  const id = Number(idTexto);
  switch (acao) {
    case 'novo': return abrirNovo(interaction);
    case 'm_novo': return criarSorteio(interaction);
    case 'proximo': return sortear(interaction, id, false);
    case 'todos': return sortear(interaction, id, true);
    case 'ressortear': return escolherPremio(interaction, id, 'sel_re', 'QUAL PRÊMIO RESSORTEAR? (O NÚMERO ATUAL FICA QUEIMADO)', { sorteados: true });
    case 'sel_re': return ressortearPremio(interaction, id);
    case 'lista': return verLista(interaction, id, 0, false);
    case 'pag': return verLista(interaction, id, Number(extra) || 0, true);
    case 'auditoria': return verAuditoria(interaction, id);
    case 'premio_add': return abrirAdicionar(interaction, id);
    case 'm_add': return adicionar(interaction, id);
    case 'premio_edit': return escolherPremio(interaction, id, 'sel_edit', 'QUAL PRÊMIO EDITAR?');
    case 'sel_edit': return abrirEditar(interaction, id);
    case 'm_edit': return editar(interaction, id, extra);
    case 'premio_del': return escolherPremio(interaction, id, 'sel_del', 'QUAL PRÊMIO REMOVER?');
    case 'sel_del': return remover(interaction, id);
    case 'atualizar': return reaplicarLista(interaction, id);
    case 'recentes': return reaplicarLista(interaction, id, { alternarRecentes: true });
    case 'concluir': return concluir(interaction, id);
    case 'entrega': return escolherPremio(interaction, id, 'sel_ent', 'QUAL PRÊMIO FOI ENTREGUE?', { sorteados: true, semEntrega: true });
    case 'sel_ent': return marcarEntrega(interaction, id);
    case 'cancelar': return pedirCancelamento(interaction, id);
    case 'cancelar_ok': return cancelar(interaction, id);
    default: return undefined;
  }
});

module.exports = { atualizarMensagem, atualizarHistorico, LEMBRETE_ENTREGA_MS };
