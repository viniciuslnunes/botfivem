const { ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const E = require('./estatisticas');
const F = require('./painelFormato');
const A = require('./analises');
const repo = require('./repositorio');
const { criarArmazemConsultas, mensagemErroConsulta } = require('./consultasEmMemoria');
const { selectPeriodo, selectBuscarJogador, linhaBotao, linhaPaginacao } = require('./painelComponentesFixos');

// Canal ⚖️・disciplina-jogo: mesmo padrão interativo do 📦・estoque-bau.
// "Advertências abertas" é ESTADO ATUAL (não filtra por período, como a lista
// de fechaduras/restrições) — por isso vira botão, não select de período; o
// select de período fica pro FLUXO (quantas foram aplicadas/cumpridas/
// perdoadas/multas num recorte de tempo).
const MODULO = 'disciplina';
const HISTORICO_MAX = 4000;
const ACOES_MULTA = ['multou'];

function linhaAdvertencia(a, i) {
  const partes = [`${i + 1}. ${F.pessoa(a)}`];
  if (a.servicos != null) partes.push(`— **${E.formatarNumero(a.servicos)} serviços**`);
  partes.push(`— ${F.haQuantoTempo(a.em)}`);
  if (a.porNome) partes.push(`· por ${F.nomeSeguro(a.porNome)}`);
  const linha = partes.join(' ');
  return a.motivo ? `${linha}\n   *${E.truncar(F.nomeSeguro(a.motivo), 120)}*` : linha;
}

function linhaMulta(m) {
  const motivo = E.extrairEntreParenteses(m.descricao);
  return `• ${F.pessoa({ nome: m.alvo_nome, id: m.alvo_id_fivem })} por ${F.nomeSeguro(m.ator_nome)} — ${E.formatarDataHora(m.ocorrido_em)}`
    + (motivo ? `\n   *${E.truncar(F.nomeSeguro(motivo), 120)}*` : '');
}

function linhaPerdao(p) {
  return `• ${F.nomeSeguro(p.ator_nome)} perdoou ${F.pessoa({ nome: p.alvo_nome, id: p.alvo_id_fivem })} — ${E.formatarDataHora(p.ocorrido_em)}`;
}

function linhaTop(l, i) {
  return `${i + 1}. ${F.pessoa(l)} — ${E.formatarNumero(l.total)}`;
}

// ── Advertências abertas: lista paginada + busca (botão da mensagem fixa) ────

const armazem = criarArmazemConsultas();

function renderizarAdvertencias(consultaId, consulta) {
  const { itens, atual, totalPaginas } = armazem.pagina(consulta.ativas, consulta.pagina ?? 0);
  const embed = {
    color: F.COR,
    title: '⚖️ ADVERTÊNCIAS ABERTAS NO JOGO',
    description: [
      ...(consulta.aviso ? [consulta.aviso, ''] : []),
      `**${consulta.ativas.length}** ${consulta.ativas.length === 1 ? 'advertência aberta' : 'advertências abertas'}`
        + ` · **${E.formatarNumero(consulta.servicosPendentes)}** serviços pendentes no total`,
      '*Aberta = o último evento do jogador foi uma advertência; cumprir ("FINALIZOU") ou ser perdoado encerra.*',
    ].join('\n'),
    fields: F.campoLista('ADVERTÊNCIAS', itens.map(linhaAdvertencia), 'Sem advertências nesta página.'),
    footer: { text: `Sem fonte de log de advertência pro Hoolibras · Página ${atual + 1}/${totalPaginas}` },
  };
  return { embeds: [embed], components: [linhaPaginacao(MODULO, consultaId, atual, totalPaginas)], allowedMentions: { parse: [] } };
}

async function abrirAdvertenciasAbertas(interaction) {
  const eventos = await repo.listarPorAcoes(A.ACOES_ADVERTENCIA, E.resolverPeriodo('tudo'), HISTORICO_MAX);
  const ativas = A.advertenciasAtivas(eventos);
  const servicosPendentes = ativas.reduce((t, a) => t + (a.servicos ?? 0), 0);
  const aviso = F.avisoFonteParada(await repo.ultimaOcorrencia(A.ACOES_ADVERTENCIA));
  const consultaId = armazem.salvar(interaction.user.id, { ativas, servicosPendentes, aviso, pagina: 0 });
  await interaction.editReply(renderizarAdvertencias(consultaId, { ativas, servicosPendentes, aviso, pagina: 0 }));
}

// ── Busca dentro da lista de advertências abertas ────────────────────────────

function modalBuscar(consultaId) {
  return new ModalBuilder()
    .setCustomId(`${MODULO}:buscarmodal:${consultaId}`)
    .setTitle('BUSCAR ADVERTÊNCIA')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('termo').setLabel('NOME OU ID DO JOGADOR')
      .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)));
}

// ── Fluxo do período (select da mensagem fixa) ───────────────────────────────

async function embedFluxo(periodo) {
  const [contagens, multas, perdoes] = await Promise.all([
    repo.contarPorAcoes([...A.ACOES_ADVERTENCIA, ...ACOES_MULTA], periodo),
    repo.listarPorAcoes(ACOES_MULTA, periodo, 10),
    repo.listarPorAcoes(['adv_removida'], periodo, 10),
  ]);
  const ROTULOS = { advertido: 'Advertências aplicadas', adv_finalizou: 'Advertências cumpridas', adv_removida: 'Advertências perdoadas', multou: 'Multas' };
  return {
    color: F.COR,
    title: `⚖️ DISCIPLINA — ${periodo.rotulo}`,
    description: 'Fluxo do período (o estado atual fica no botão ADVERTÊNCIAS ABERTAS).',
    fields: [
      ...F.campoLista('POR TIPO', contagens.map(c => `• **${ROTULOS[c.acao] ?? c.acao}:** ${E.formatarNumero(c.total)}`), 'Nenhum evento no período.'),
      ...(multas.length ? [{ name: 'MULTAS DO PERÍODO', value: E.truncar(multas.map(linhaMulta).join('\n'), 1024) }] : []),
      ...(perdoes.length ? [{ name: 'PERDÕES DO PERÍODO', value: E.truncar(perdoes.map(linhaPerdao).join('\n'), 1024) }] : []),
    ],
    footer: { text: F.rodape('canal logs-registros') },
  };
}

// ── Ficha de jogador ─────────────────────────────────────────────────────────

async function embedFichaJogador(idFivem, nomeConhecido) {
  const eventos = await repo.eventosDoAlvo(idFivem, [...A.ACOES_ADVERTENCIA, ...ACOES_MULTA], 300);
  const advertencias = eventos.filter(e => A.ACOES_ADVERTENCIA.includes(e.acao));
  const aberta = advertencias[0]?.acao === 'advertido' ? advertencias[0] : null;
  const multas = eventos.filter(e => e.acao === 'multou');
  return {
    color: F.COR,
    title: `⚖️ ${F.nomeSeguro(nomeConhecido ?? idFivem)} — DISCIPLINA`,
    description: [
      `**ID:** \`${idFivem}\``,
      aberta
        ? `**Advertência:** ABERTA — ${E.formatarNumero(E.extrairServicos(aberta.descricao) ?? 0)} serviços, ${F.haQuantoTempo(aberta.ocorrido_em)}`
        : '**Advertência:** nenhuma aberta',
      `**Total de multas:** ${E.formatarNumero(multas.length)}`,
    ].filter(Boolean).join('\n'),
    fields: F.campoLista('HISTÓRICO RECENTE', eventos.slice(0, 8).map(e => (e.acao === 'multou'
      ? linhaMulta(e)
      : `• ${e.acao} — ${E.formatarDataHora(e.ocorrido_em)}${e.ator_nome ? ` · por ${F.nomeSeguro(e.ator_nome)}` : ''}`)), 'Nenhum evento registrado.'),
    footer: { text: F.rodape('canal logs-registros') },
  };
}

function linhaComponentesDisciplina() {
  return [
    linhaBotao(MODULO, 'ativas', 'ADVERTÊNCIAS ABERTAS', { emoji: '⚖️' }),
    selectBuscarJogador(MODULO),
    selectPeriodo(MODULO, { placeholder: 'VER FLUXO DE UM PERÍODO' }),
  ];
}

registrarModulo(MODULO, async interaction => {
  const [, acao, a, b] = interaction.customId.split(':');

  if (interaction.isButton() && acao === 'ativas') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    await abrirAdvertenciasAbertas(interaction);
    return;
  }

  if (interaction.isButton() && acao === 'pag') {
    const { erro } = armazem.obter(a, interaction.user.id);
    if (erro) return interaction.update({ content: mensagemErroConsulta(erro), embeds: [], components: [] });
    const atualizada = armazem.atualizar(a, { pagina: Number(b) || 0 });
    await interaction.update(renderizarAdvertencias(a, atualizada));
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
    const termo = E.normalizarBusca(interaction.fields.getTextInputValue('termo'));
    const encontradas = consulta.ativas.filter(v => E.normalizarBusca(v.nome ?? '').includes(termo) || String(v.id).includes(termo));
    if (!encontradas.length) return interaction.reply({ content: `❌ NENHUMA ADVERTÊNCIA ABERTA PARA \`${interaction.fields.getTextInputValue('termo')}\`.`, flags: 64 });
    return interaction.reply({
      content: `🔎 ${encontradas.length} ${encontradas.length === 1 ? 'RESULTADO' : 'RESULTADOS'}:`,
      embeds: encontradas.slice(0, 10).map((v, i) => ({ color: F.COR, description: linhaAdvertencia(v, i) })),
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
    await interaction.editReply({ embeds: [await embedFichaJogador(idFivem, membro.displayName)] });
    return;
  }

  if (interaction.isStringSelectMenu() && acao === 'selperiodo') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    await interaction.editReply({ embeds: [await embedFluxo(E.resolverPeriodo(interaction.values[0]))] });
    return;
  }
});

module.exports = { linhaComponentesDisciplina, linhaMulta, linhaTop };
