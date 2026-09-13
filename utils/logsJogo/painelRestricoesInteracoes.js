const { ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const { buscarBloqueio } = require('../naoRecrutar');
const E = require('./estatisticas');
const F = require('./painelFormato');
const A = require('./analises');
const repo = require('./repositorio');
const { criarArmazemConsultas, mensagemErroConsulta } = require('./consultasEmMemoria');
const { selectPeriodo, selectBuscarJogador, linhaPaginacao } = require('./painelComponentesFixos');

// Canal ⛔・banidos-e-impedidos: mesmo padrão interativo do 📦・estoque-bau. A
// pergunta natural aqui não é "período" (é ESTADO ATUAL: quem está barrado
// agora), então o primeiro select filtra por TIPO (blacklist/suspensão/
// impedimento), não por tempo — o select de período fica pro fluxo (o que foi
// aplicado/retirado numa janela).
const MODULO = 'restricoes';
const HISTORICO_MAX = 6000;

const TIPOS_SELECT = [
  { value: '*', label: 'TODOS OS TIPOS' },
  { value: 'blacklist', label: 'BLACKLIST' },
  { value: 'suspensao', label: 'SUSPENSÃO' },
  { value: 'impedimento', label: 'IMPEDIMENTO' },
];

const armazem = criarArmazemConsultas();

// Só blacklist é cruzada com o não-recrutar (ver painelRestricoes.js original):
// suspensão é temporária e impedimento liga/desliga o tempo todo.
async function marcarBloqueioNoDiscord(client, restricoes) {
  const marcadas = [];
  let avisou = false;
  for (const r of restricoes) {
    if (r.tipo !== 'blacklist') { marcadas.push({ ...r, bloqueadoNoDiscord: null }); continue; }
    let bloqueado = null;
    try {
      bloqueado = Boolean(await buscarBloqueio(client, r.id));
    } catch (err) {
      if (!avisou) console.error('[restricoes] Erro ao consultar o não-recrutar:', err);
      avisou = true;
    }
    marcadas.push({ ...r, bloqueadoNoDiscord: bloqueado });
  }
  return marcadas;
}

function linhaRestricao(r) {
  const marca = r.bloqueadoNoDiscord === true ? ' · já no não-recrutar'
    : r.bloqueadoNoDiscord === false ? ' · ⚠️ fora do não-recrutar'
      : '';
  return `• ${F.pessoa(r)} — ${r.rotulo} ${F.haQuantoTempo(r.em)}`
    + (r.porNome ? ` · por ${F.nomeSeguro(r.porNome)}` : '') + marca;
}

function renderizarLista(consultaId, consulta) {
  const { itens, atual, totalPaginas } = armazem.pagina(consulta.ativas, consulta.pagina ?? 0);
  const faltaBloquear = consulta.ativas.filter(r => r.bloqueadoNoDiscord === false).length;
  const embed = {
    color: F.COR,
    title: `⛔ RESTRIÇÕES ATIVAS${consulta.tipo ? ` — ${consulta.tipo.toUpperCase()}` : ''} (${consulta.ativas.length})`,
    description: faltaBloquear ? `⚠️ **${faltaBloquear}** com blacklist ainda fora do ❌・nao-recrutar.` : undefined,
    fields: F.campoLista('RESTRIÇÕES', itens.map(linhaRestricao), 'Ninguém nesta lista.'),
    footer: { text: `${F.rodape('canal logs-registros')} · Página ${atual + 1}/${totalPaginas}` },
  };
  const selectTipo = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(`${MODULO}:seltipo:${consultaId}`).setPlaceholder('FILTRAR POR TIPO')
      .addOptions(TIPOS_SELECT.map(t => ({ ...t, default: (consulta.tipo ?? '*') === t.value })))
  );
  return { embeds: [embed], components: [selectTipo, linhaPaginacao(MODULO, consultaId, atual, totalPaginas)], allowedMentions: { parse: [] } };
}

async function buscarAtivas(client, tipo) {
  const eventos = await repo.listarPorAcoes(A.ACOES_RESTRICAO, E.resolverPeriodo('tudo'), HISTORICO_MAX);
  let ativas = A.restricoesAtivas(eventos);
  if (tipo && tipo !== '*') ativas = ativas.filter(r => r.tipo === tipo);
  return marcarBloqueioNoDiscord(client, ativas);
}

async function abrirLista(interaction, tipo) {
  const ativas = await buscarAtivas(interaction.client, tipo);
  const consultaId = armazem.salvar(interaction.user.id, { ativas, tipo: tipo === '*' ? null : tipo, pagina: 0 });
  await interaction.editReply(renderizarLista(consultaId, { ativas, tipo: tipo === '*' ? null : tipo, pagina: 0 }));
}

// ── Busca dentro da lista aberta ──────────────────────────────────────────────

function modalBuscar(consultaId) {
  return new ModalBuilder()
    .setCustomId(`${MODULO}:buscarmodal:${consultaId}`)
    .setTitle('BUSCAR RESTRIÇÃO')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('termo').setLabel('NOME OU ID DO JOGADOR')
      .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)));
}

// ── Fluxo do período ──────────────────────────────────────────────────────────

const ROTULOS_ACAO = {
  blacklist_adicionou: 'Blacklist aplicada', blacklist_removeu: 'Blacklist retirada',
  suspensao_adicionou: 'Suspensão aplicada', suspensao_removeu: 'Suspensão retirada',
  impedimento_adicionou: 'Impedimento aplicado', impedimento_removeu: 'Impedimento retirado',
};

async function embedFluxo(periodo) {
  const [contagens, topAplicou] = await Promise.all([
    repo.contarPorAcoes(A.ACOES_RESTRICAO, periodo),
    repo.topAtoresPorAcoes(A.ACOES_RESTRICAO, periodo, 10),
  ]);
  return {
    color: F.COR,
    title: `⛔ RESTRIÇÕES — ${periodo.rotulo}`,
    description: 'O que foi aplicado e retirado no período (quem está barrado HOJE tem botão próprio).',
    fields: [
      ...F.campoLista('POR TIPO', contagens.map(c => `• **${ROTULOS_ACAO[c.acao] ?? c.acao}:** ${E.formatarNumero(c.total)}`), 'Nenhum evento no período.'),
      ...(topAplicou.length ? [{ name: 'QUEM MAIS APLICOU RESTRIÇÃO', value: topAplicou.map((l, i) => `${i + 1}. ${F.pessoa(l)} — ${E.formatarNumero(l.total)}`).join('\n') }] : []),
    ],
    footer: { text: F.rodape('canal logs-registros') },
  };
}

// ── Ficha de jogador ─────────────────────────────────────────────────────────

async function embedFichaJogador(client, idFivem, nomeConhecido) {
  const eventos = await repo.eventosDoAlvo(idFivem, A.ACOES_RESTRICAO, 300);
  const status = Object.keys(A.TIPOS_RESTRICAO).map(tipo => {
    const ultimo = eventos.find(e => A.TIPOS_RESTRICAO[tipo].adicionou === e.acao || A.TIPOS_RESTRICAO[tipo].removeu === e.acao);
    return { tipo, ativo: ultimo?.acao === A.TIPOS_RESTRICAO[tipo].adicionou, ultimo };
  });
  const blacklistAtivo = status.find(s => s.tipo === 'blacklist')?.ativo;
  let bloqueadoNoDiscord = null;
  if (blacklistAtivo) {
    try { bloqueadoNoDiscord = Boolean(await buscarBloqueio(client, idFivem)); } catch { /* segue sem a marca */ }
  }
  return {
    color: F.COR,
    title: `⛔ ${F.nomeSeguro(nomeConhecido ?? idFivem)} — RESTRIÇÕES`,
    description: [
      `**ID:** \`${idFivem}\``,
      ...status.map(s => `**${A.TIPOS_RESTRICAO[s.tipo].rotulo}:** ${s.ativo ? `ATIVA (${F.haQuantoTempo(s.ultimo.ocorrido_em)})` : 'sem restrição'}`),
      blacklistAtivo ? (bloqueadoNoDiscord === null ? null : bloqueadoNoDiscord ? 'já está no ❌・nao-recrutar' : '⚠️ **FALTA BLOQUEAR NO ❌・NAO-RECRUTAR**') : null,
    ].filter(Boolean).join('\n'),
    fields: F.campoLista('HISTÓRICO RECENTE', eventos.slice(0, 6).map(e => `• ${ROTULOS_ACAO[e.acao] ?? e.acao} — por ${F.nomeSeguro(e.ator_nome)}, ${E.formatarDataHora(e.ocorrido_em)}`), 'Nenhum evento registrado.'),
    footer: { text: F.rodape('canal logs-registros') },
  };
}

function linhaComponentesRestricoes() {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`${MODULO}:abrirtipo`).setPlaceholder('VER QUEM ESTÁ RESTRITO (POR TIPO)')
        .addOptions(TIPOS_SELECT)
    ),
    selectBuscarJogador(MODULO),
    selectPeriodo(MODULO, { placeholder: 'VER O QUE FOI APLICADO NUM PERÍODO' }),
  ];
}

registrarModulo(MODULO, async interaction => {
  const [, acao, a, b] = interaction.customId.split(':');

  if (interaction.isStringSelectMenu() && acao === 'abrirtipo') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    await abrirLista(interaction, interaction.values[0]);
    return;
  }

  if (interaction.isStringSelectMenu() && acao === 'seltipo') {
    const { erro } = armazem.obter(a, interaction.user.id);
    if (erro) return interaction.update({ content: mensagemErroConsulta(erro), embeds: [], components: [] });
    await interaction.deferUpdate();
    const tipo = interaction.values[0];
    const ativas = await buscarAtivas(interaction.client, tipo);
    const atualizada = armazem.atualizar(a, { ativas, tipo: tipo === '*' ? null : tipo, pagina: 0 });
    await interaction.editReply(renderizarLista(a, atualizada));
    return;
  }

  if (interaction.isButton() && acao === 'pag') {
    const { erro } = armazem.obter(a, interaction.user.id);
    if (erro) return interaction.update({ content: mensagemErroConsulta(erro), embeds: [], components: [] });
    const atualizada = armazem.atualizar(a, { pagina: Number(b) || 0 });
    await interaction.update(renderizarLista(a, atualizada));
    return;
  }

  if (interaction.isButton() && acao === 'buscar') {
    const { erro } = armazem.obter(a, interaction.user.id);
    if (erro) return interaction.reply({ content: mensagemErroConsulta(erro), flags: 64 });
    return interaction.showModal(modalBuscar(a));
  }

  if (interaction.isModalSubmit() && acao === 'buscarmodal') {
    const { consulta, erro } = armazem.obter(a, interaction.user.id);
    if (erro) return interaction.reply({ content: mensagemErroConsulta(erro), flags: 64 });
    const termoBruto = interaction.fields.getTextInputValue('termo');
    const termo = E.normalizarBusca(termoBruto);
    const encontradas = consulta.ativas.filter(r => E.normalizarBusca(r.nome ?? '').includes(termo) || String(r.id).includes(termo));
    if (!encontradas.length) return interaction.reply({ content: `❌ NENHUMA RESTRIÇÃO ATIVA PARA \`${termoBruto}\`.`, flags: 64 });
    return interaction.reply({
      content: `🔎 ${encontradas.length} ${encontradas.length === 1 ? 'RESULTADO' : 'RESULTADOS'}:`,
      embeds: [{ color: F.COR, description: encontradas.slice(0, 15).map(linhaRestricao).join('\n') }],
      flags: 64, allowedMentions: { parse: [] },
    });
  }

  if (interaction.isUserSelectMenu() && acao === 'buscarjogador') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const membro = interaction.members.first();
    const idFivem = E.idFivemDoNick(membro?.nickname ?? membro?.displayName);
    if (!idFivem) {
      return interaction.reply({ content: `❌ ${membro ?? 'ESSE MEMBRO'} NÃO TEM ID DO JOGO NO APELIDO (PADRÃO "... - 1234").`, flags: 64, allowedMentions: { parse: [] } });
    }
    await interaction.deferReply({ flags: 64 });
    await interaction.editReply({ embeds: [await embedFichaJogador(interaction.client, idFivem, membro.displayName)] });
    return;
  }

  if (interaction.isStringSelectMenu() && acao === 'selperiodo') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    await interaction.editReply({ embeds: [await embedFluxo(E.resolverPeriodo(interaction.values[0]))] });
    return;
  }
});

module.exports = { linhaComponentesRestricoes, buscarAtivas };
