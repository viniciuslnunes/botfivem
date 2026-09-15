const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const config = require('../../config/index.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const E = require('./estatisticas');
const F = require('./painelFormato');
const repo = require('./repositorio');
const { criarArmazemConsultas, mensagemErroConsulta } = require('./consultasEmMemoria');
const { selectPeriodo, selectBuscarJogador, linhaPaginacao } = require('./painelComponentesFixos');

// Piloto do padrão "canal-painel interativo" (ver docs/inteligencia-logs-jogo.md
// § "Padrão de UI"). Escolher período, filtrar por baú, buscar item/jogador e
// ranking são tudo botão/select que abre uma resposta EPHEMERAL.
//
// Histórico cronológico, não saldo agregado (pedido do usuário em 2026-09-15,
// mesma virada já feita em fechaduras): um saldo por item ("guardou 95 ·
// saiu 89") não diz QUEM guardou nem QUEM retirou — só o total. Escolher um
// período agora abre a lista de EVENTOS individuais (quem, o quê, quanto,
// qual baú, quando), igual ao histórico de fechaduras — período inteiro
// (sem teto real), pagina como antes.
const MODULO = 'estoquebau';
const ACOES_BAU = ['bau_guardou', 'bau_removeu'];
const TETO_HISTORICO = 100000; // não é um corte real, só o LIMIT do SQL
const LIMITE_FICHA = 50;
const armazem = criarArmazemConsultas();

function qtd(n) {
  return E.formatarNumero(Math.round(Number(n) || 0));
}

// ── Componentes da mensagem fixa (o que este módulo empresta a painelBau.js) ─

function selectCompartimento(baus) {
  if (!baus.length) return null;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${MODULO}:selcompartimento`)
      .setPlaceholder('VER UM COMPARTIMENTO (TUDO)')
      .addOptions(baus.map(b => ({ label: b, value: b })))
  );
}

function linhaBotoesAcao() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${MODULO}:ranking`).setLabel('RANKING').setEmoji('🏆').setStyle(ButtonStyle.Secondary)
  );
}

// As linhas de componente da mensagem fixa do canal — importado por
// painelBau.js pra colar na mesma mensagem do embed resumo. `baus` vem do
// próprio painelBau.js (já calcula a lista pro "COMPARTIMENTOS: N" do embed).
function linhaComponentesBau(baus = []) {
  return [selectPeriodo(MODULO), selectBuscarJogador(MODULO), selectCompartimento(baus), linhaBotoesAcao()].filter(Boolean);
}

// ── Histórico cronológico (uma consulta = um período + filtro de baú opcional) ─

function bausDaLista(eventos) {
  return [...new Set(eventos.map(e => e.bau).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// Carrega TODOS os eventos do período (guardou/removeu, qualquer baú) e
// resolve o nome de quem mexeu pelo último apelido visto (o log do baú comum
// só traz o ID — Baú de Recompensas já vem com nome, F.comNomes não toca
// linha que já tem `ator_nome`).
async function buscarDadosHistorico(periodo) {
  const brutos = await repo.listarPorAcoes(ACOES_BAU, periodo, TETO_HISTORICO);
  const comBau = brutos.map(e => ({ ...e, bau: E.bauDoTitulo(e.titulo) ?? '?' }));
  const eventos = await F.comNomes(comBau, { id: 'ator_id_fivem', nome: 'ator_nome' });
  return { periodo, bauFiltro: null, pagina: 0, eventos, baus: bausDaLista(eventos) };
}

// ── Renderização da lista paginada de eventos ────────────────────────────────

function linhaEvento(e, comBau) {
  const sinal = e.acao === 'bau_guardou' ? '📥 guardou' : '📤 retirou';
  const prefixo = comBau ? `**[${F.nomeSeguro(e.bau)}]** ` : '';
  return `${prefixo}${F.pessoa({ nome: e.ator_nome, id: e.ator_id_fivem })} ${sinal} **${qtd(e.valor)}× ${F.nomeSeguro(e.alvo_nome)}** — ${E.formatarDataHora(e.ocorrido_em)}`;
}

function selectFiltroBau(consultaId, baus, atual) {
  if (!baus.length) return null;
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${MODULO}:selbau:${consultaId}`)
    .setPlaceholder('FILTRAR POR BAÚ')
    .addOptions([
      { label: 'TODOS OS BAÚS', value: '*', default: !atual },
      ...baus.map(b => ({ label: b, value: b, default: atual === b })),
    ]);
  return new ActionRowBuilder().addComponents(select);
}

function eventosFiltrados(consulta) {
  return consulta.bauFiltro ? consulta.eventos.filter(e => e.bau === consulta.bauFiltro) : consulta.eventos;
}

function totais(eventos) {
  const guardou = eventos.filter(e => e.acao === 'bau_guardou').reduce((t, e) => t + Number(e.valor || 0), 0);
  const removeu = eventos.filter(e => e.acao === 'bau_removeu').reduce((t, e) => t + Number(e.valor || 0), 0);
  return { guardou, removeu };
}

function renderizarHistorico(consultaId, consulta) {
  const filtrados = eventosFiltrados(consulta);
  const { itens, atual, totalPaginas } = armazem.pagina(filtrados, consulta.pagina);
  const { guardou, removeu } = totais(filtrados);

  const embed = {
    color: F.COR,
    title: `📦 BAÚ — ${consulta.periodo.rotulo}${consulta.bauFiltro ? ` · ${consulta.bauFiltro.toUpperCase()}` : ''}`,
    description: [
      `**${qtd(filtrados.length)}** ${filtrados.length === 1 ? 'movimento' : 'movimentos'} no período`
        + ` · guardou **${qtd(guardou)}** · retirou **${qtd(removeu)}**`,
      '*Cada linha é um evento do jogo — quem mexeu, o que fez e quando. Não é saldo agregado.*',
    ].join('\n'),
    fields: F.campoLista('MOVIMENTOS', itens.map(e => linhaEvento(e, !consulta.bauFiltro)), 'Sem movimentos nesta página.', { numerar: false }),
    footer: { text: `${F.rodape('canal logs-baú')} · Página ${atual + 1}/${totalPaginas}` },
  };

  const linhaFiltro = selectFiltroBau(consultaId, consulta.baus, consulta.bauFiltro);
  return { embeds: [embed], components: [linhaFiltro, linhaPaginacao(MODULO, consultaId, atual, totalPaginas)].filter(Boolean), allowedMentions: { parse: [] } };
}

async function abrirEstoqueBau(interaction, periodo) {
  const dados = await buscarDadosHistorico(periodo);
  const consultaId = armazem.salvar(interaction.user.id, dados);
  await interaction.editReply(renderizarHistorico(consultaId, dados));
}

// ── Ranking (mesmo fluxo do painel de jogadores: botão → select de período) ──

function linhaRanking(l, i) {
  return `${i + 1}. ${F.pessoa(l)} — retirou **${qtd(l.removeu)}** · guardou ${qtd(l.guardou)}`;
}

function linhaRetirada(l) {
  return `• ${F.pessoa(l)} tirou **${qtd(l.quantidade)}× ${F.nomeSeguro(l.item)}** `
    + `de ${F.nomeSeguro(E.bauDoTitulo(l.titulo) ?? 'baú')} — ${E.formatarDataHora(l.ocorrido_em)}`;
}

async function embedRanking(periodo) {
  const [pessoas, retiradas] = await Promise.all([
    repo.movimentoBauPorPessoa(periodo, 10).then(F.comNomes),
    repo.maioresRetiradasBau(periodo, 5).then(F.comNomes),
  ]);
  return {
    color: F.COR,
    title: `🏆 RANKING DO BAÚ — ${periodo.rotulo}`,
    description: 'Ordenado por quanto cada um RETIROU (é o lado que gera prejuízo se for indevido).',
    fields: [
      { name: `TOP ${pessoas.length}`, value: pessoas.map(linhaRanking).join('\n') || '*Sem dados no período.*' },
      ...(retiradas.length
        ? [{ name: `MAIORES RETIRADAS DE UMA VEZ (alerta acima de ${qtd(config.logsJogo.bau.alertaRetiradaQtd)})`, value: E.truncar(retiradas.map(linhaRetirada).join('\n'), 1024) }]
        : []),
    ],
    footer: { text: F.rodape('canal logs-baú') },
    timestamp: new Date().toISOString(),
  };
}

// ── Busca dentro do período aberto (item OU ID/nome de jogador) ─────────────

function modalBuscar(consultaId) {
  return new ModalBuilder()
    .setCustomId(`${MODULO}:buscarmodal:${consultaId}`)
    .setTitle('BUSCAR NO BAÚ')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('termo').setLabel('ITEM, ID OU NOME DE JOGADOR')
      .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)));
}

// Busca nos EVENTOS do período inteiro (não só na página aberta, nem só no
// filtro de baú atual) — pra "nessa data, quem mexeu nesse item" achar tudo.
function buscarEventos(consulta, termoBruto) {
  const termoDigitado = termoBruto.trim();
  const termo = E.normalizarBusca(termoDigitado);
  if (!termo) return [];
  return consulta.eventos.filter(e => E.normalizarBusca(e.alvo_nome ?? '').includes(termo)
    || (termoDigitado && String(e.ator_id_fivem ?? '') === termoDigitado)
    || E.normalizarBusca(e.ator_nome ?? '').includes(termo));
}

function embedResultadoBusca(termo, periodo, eventos) {
  const { guardou, removeu } = totais(eventos);
  return {
    color: F.COR,
    title: `🔎 BAÚ — "${termo.toUpperCase()}" EM ${periodo.rotulo.toUpperCase()}`,
    description: eventos.length
      ? `**${qtd(eventos.length)}** ${eventos.length === 1 ? 'movimento encontrado' : 'movimentos encontrados'} · guardou **${qtd(guardou)}** · retirou **${qtd(removeu)}**`
      : 'Nenhum movimento encontrado nesse período.',
    fields: F.campoLista('MOVIMENTOS', eventos.slice(0, 100).map(e => linhaEvento(e, true)), 'Nenhum movimento encontrado.', { numerar: false }),
    footer: { text: `${F.rodape('canal logs-baú')}${eventos.length > 100 ? ' · mostrando os 100 mais recentes' : ''}` },
  };
}

function linhaEventoPessoa(e) {
  const sinal = e.acao === 'bau_guardou' ? '📥 guardou' : '📤 retirou';
  return `• ${sinal} **${qtd(e.quantidade)}× ${F.nomeSeguro(e.item)}** de ${F.nomeSeguro(E.bauDoTitulo(e.titulo) ?? 'baú')} — ${E.formatarDataHora(e.ocorrido_em)}`;
}

async function embedFichaPessoa(idFivem, nomeConhecido) {
  const dados = await repo.atividadeBauPorId(idFivem, LIMITE_FICHA);
  return {
    color: F.COR,
    title: `📦 ${F.nomeSeguro(nomeConhecido ?? idFivem)} — ATIVIDADE NO BAÚ`,
    description: [
      `**ID:** \`${idFivem}\``,
      `**Guardou (total):** ${qtd(dados.guardou)}`,
      `**Retirou (total):** ${qtd(dados.removeu)}`,
      dados.desde ? `**Desde:** ${E.formatarDataHora(dados.desde)}` : null,
    ].filter(Boolean).join('\n'),
    fields: F.campoLista('ÚLTIMOS MOVIMENTOS', dados.eventos.map(linhaEventoPessoa), 'Nenhum movimento registrado.'),
    footer: { text: F.rodape('canal logs-baú') },
  };
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

registrarModulo(MODULO, async interaction => {
  const [, acao, a, b] = interaction.customId.split(':');

  if (interaction.isStringSelectMenu() && acao === 'selperiodo') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    await abrirEstoqueBau(interaction, E.resolverPeriodo(interaction.values[0]));
    return;
  }

  if (interaction.isStringSelectMenu() && acao === 'selcompartimento') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    const dados = await buscarDadosHistorico(E.resolverPeriodo('tudo'));
    dados.bauFiltro = interaction.values[0];
    const consultaId = armazem.salvar(interaction.user.id, dados);
    await interaction.editReply(renderizarHistorico(consultaId, dados));
    return;
  }

  if (interaction.isUserSelectMenu() && acao === 'buscarjogador') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const membro = interaction.members.first();
    const idFivem = E.idFivemDoNick(membro?.nickname ?? membro?.displayName);
    if (!idFivem) {
      return interaction.reply({
        content: `❌ ${membro ?? 'ESSE MEMBRO'} NÃO TEM ID DO JOGO NO APELIDO (PADRÃO "... - 1234").`,
        flags: 64, allowedMentions: { parse: [] },
      });
    }
    await interaction.deferReply({ flags: 64 });
    await interaction.editReply({ embeds: [await embedFichaPessoa(idFivem, membro.displayName)] });
    return;
  }

  if (interaction.isButton() && acao === 'ranking') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    return interaction.reply({ components: [selectPeriodo(MODULO, { acao: 'selrankingperiodo', placeholder: 'ESCOLHA UM PERÍODO PARA O RANKING' })], flags: 64 });
  }

  if (interaction.isStringSelectMenu() && acao === 'selrankingperiodo') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    await interaction.editReply({ embeds: [await embedRanking(E.resolverPeriodo(interaction.values[0]))] });
    return;
  }

  // Ações abaixo mexem numa consulta já aberta (`a` é o consultaId) — todas
  // checam dono/expiração do mesmo jeito (ver consultasEmMemoria.js).
  if (interaction.isStringSelectMenu() && acao === 'selbau') {
    const { erro } = armazem.obter(a, interaction.user.id);
    if (erro) return interaction.reply({ content: mensagemErroConsulta(erro), flags: 64 });
    const bauEscolhido = interaction.values[0] === '*' ? null : interaction.values[0];
    const atualizada = armazem.atualizar(a, { bauFiltro: bauEscolhido, pagina: 0 });
    await interaction.update(renderizarHistorico(a, atualizada));
    return;
  }

  if (interaction.isButton() && acao === 'pag') {
    const { erro } = armazem.obter(a, interaction.user.id);
    if (erro) return interaction.update({ content: mensagemErroConsulta(erro), embeds: [], components: [] });
    const atualizada = armazem.atualizar(a, { pagina: Number(b) || 0 });
    await interaction.update(renderizarHistorico(a, atualizada));
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
    const termo = interaction.fields.getTextInputValue('termo');
    const encontrados = buscarEventos(consulta, termo);
    return interaction.reply({ embeds: [embedResultadoBusca(termo, consulta.periodo, encontrados)], flags: 64 });
  }
});

module.exports = { linhaComponentesBau };
