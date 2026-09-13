const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const config = require('../../config/index.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const E = require('./estatisticas');
const F = require('./painelFormato');
const repo = require('./repositorio');
const { criarArmazemConsultas, mensagemErroConsulta } = require('./consultasEmMemoria');
const { PERIODOS } = require('./painelConsulta');

// Piloto do padrão "canal-painel interativo": a mensagem fixa do canal fica
// curta (só os números-chave) e toda a exploração — período, filtro por baú,
// busca por item/jogador, ranking — mora atrás de botões/selects, sempre numa
// resposta EPHEMERAL (só quem clicou vê), do mesmo jeito que o painel de
// jogadores (utils/logsJogo/presencaInteracoes.js) já faz. Validado aqui
// primeiro (canal 📦・estoque-bau); dando certo, os outros 8 canais de log
// trocam a listagem direta no canal por este mesmo mecanismo.
const MODULO = 'estoquebau';
const armazem = criarArmazemConsultas();

function qtd(n) {
  return E.formatarNumero(Math.round(Number(n) || 0));
}

// ── Componentes da mensagem fixa (o que este módulo empresta a painelBau.js) ─

function selectPeriodo() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${MODULO}:selperiodo`)
      .setPlaceholder('ESCOLHA UM PERÍODO')
      .addOptions(PERIODOS.map(p => ({ label: p.label, value: p.chave })))
  );
}

function selectBuscarJogador() {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`${MODULO}:buscarjogador`)
      .setPlaceholder('🔎 BUSCAR JOGADOR (DISCORD)')
  );
}

function linhaBotoesAcao() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${MODULO}:ranking`).setLabel('RANKING').setEmoji('🏆').setStyle(ButtonStyle.Secondary)
  );
}

// As 3 linhas de componente da mensagem fixa do canal — importado por
// painelBau.js pra colar na mesma mensagem do embed resumo.
function linhaComponentesBau() {
  return [selectPeriodo(), selectBuscarJogador(), linhaBotoesAcao()];
}

// ── Dados por período (uma consulta = um período + filtro de baú opcional) ──

async function comNomes(linhas) {
  return F.comNomes(linhas);
}

function bausDaLista(itens) {
  return [...new Set(itens.map(i => i.bau).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

async function buscarDadosPeriodo(periodo) {
  const itensTodos = await repo.saldoBauPeriodo(periodo);
  return { periodo, bauFiltro: null, pagina: 0, itensTodos, baus: bausDaLista(itensTodos) };
}

// ── Renderização da lista paginada de itens ──────────────────────────────────

function linhaItem(l, comBau) {
  const sinal = l.saldo > 0 ? '▲' : l.saldo < 0 ? '▼' : '➖';
  const prefixo = comBau ? `**[${F.nomeSeguro(l.bau)}]** ` : '';
  return `${prefixo}${sinal} **${F.nomeSeguro(l.item)}** — saldo **${qtd(l.saldo)}** (entrou ${qtd(l.guardou)} · saiu ${qtd(l.removeu)})`;
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

function renderizarListaItens(consultaId, consulta) {
  const itensFiltrados = consulta.bauFiltro ? consulta.itensTodos.filter(i => i.bau === consulta.bauFiltro) : consulta.itensTodos;
  const { itens, atual, totalPaginas } = armazem.pagina(itensFiltrados, consulta.pagina);
  const negativos = itensFiltrados.filter(i => i.saldo < 0).length;

  const embed = {
    color: F.COR,
    title: `📦 BAÚ — ${consulta.periodo.rotulo}${consulta.bauFiltro ? ` · ${consulta.bauFiltro.toUpperCase()}` : ''}`,
    description: [
      `**${itensFiltrados.length}** ${itensFiltrados.length === 1 ? 'item movimentado' : 'itens movimentados'}`
        + (negativos ? ` · **${negativos}** com saldo negativo` : ''),
      '*Saldo líquido do período (guardou − removeu) — não é o estoque total.*',
      '',
      itens.map(l => linhaItem(l, !consulta.bauFiltro)).join('\n') || '*Sem itens nesta página.*',
    ].join('\n'),
    footer: { text: `${F.rodape('canal logs-baú')} · Página ${atual + 1}/${totalPaginas}` },
  };

  const linhaFiltro = selectFiltroBau(consultaId, consulta.baus, consulta.bauFiltro);
  const temAnterior = atual > 0;
  const temProxima = atual < totalPaginas - 1;
  const botoes = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${MODULO}:pag:${consultaId}:${atual - 1}`)
      .setLabel(temAnterior ? `◀ ANTERIOR (${atual}/${totalPaginas})` : '◀ ANTERIOR')
      .setStyle(ButtonStyle.Secondary).setDisabled(!temAnterior),
    new ButtonBuilder()
      .setCustomId(`${MODULO}:pag:${consultaId}:${atual + 1}`)
      .setLabel(temProxima ? `PRÓXIMA ▶ (${atual + 2}/${totalPaginas})` : 'PRÓXIMA ▶')
      .setStyle(ButtonStyle.Secondary).setDisabled(!temProxima),
    new ButtonBuilder().setCustomId(`${MODULO}:buscar:${consultaId}`).setLabel('🔎 BUSCAR').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [linhaFiltro, botoes].filter(Boolean), allowedMentions: { parse: [] } };
}

async function abrirEstoqueBau(interaction, periodo) {
  const dados = await buscarDadosPeriodo(periodo);
  const consultaId = armazem.salvar(interaction.user.id, dados);
  await interaction.editReply(renderizarListaItens(consultaId, dados));
}

// ── Ranking (mesmo fluxo do painel de jogadores: botão → select de período) ──

function selectPeriodoRanking() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${MODULO}:selrankingperiodo`)
      .setPlaceholder('ESCOLHA UM PERÍODO PARA O RANKING')
      .addOptions(PERIODOS.map(p => ({ label: p.label, value: p.chave })))
  );
}

function linhaRanking(l, i) {
  return `${i + 1}. ${F.pessoa(l)} — retirou **${qtd(l.removeu)}** · guardou ${qtd(l.guardou)}`;
}

function linhaRetirada(l) {
  return `• ${F.pessoa(l)} tirou **${qtd(l.quantidade)}× ${F.nomeSeguro(l.item)}** `
    + `de ${F.nomeSeguro(E.bauDoTitulo(l.titulo) ?? 'baú')} — ${E.formatarDataHora(l.ocorrido_em)}`;
}

async function embedRanking(periodo) {
  const [pessoas, retiradas] = await Promise.all([
    repo.movimentoBauPorPessoa(periodo, 10).then(comNomes),
    repo.maioresRetiradasBau(periodo, 5).then(comNomes),
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

// ── Busca por item ou jogador (modal → select de resultado → ficha) ─────────

function modalBuscar(consultaId) {
  return new ModalBuilder()
    .setCustomId(`${MODULO}:buscarmodal:${consultaId}`)
    .setTitle('BUSCAR NO BAÚ')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('termo').setLabel('ITEM OU JOGADOR (NOME/ID)')
      .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)));
}

// Busca só entre os ITENS da consulta aberta — buscar por jogador é sempre por
// ID (o log do baú não traz nome, ver o "if" de dígitos no handler do modal).
function buscarItens(consulta, termoBruto) {
  const termo = E.normalizarBusca(termoBruto.trim());
  if (!termo) return [];
  return consulta.itensTodos
    .filter(l => E.normalizarBusca(l.item).includes(termo))
    .map(l => ({
      valor: `item:${l.bau}|${l.item}`,
      label: `${l.item} (${l.bau})`.slice(0, 100),
      description: `saldo ${qtd(l.saldo)} · entrou ${qtd(l.guardou)} · saiu ${qtd(l.removeu)}`.slice(0, 100),
    }));
}

function embedFichaItem(consulta, bau, item) {
  const linha = consulta.itensTodos.find(l => l.bau === bau && l.item === item);
  if (!linha) return { color: F.COR, title: '📦 Item não encontrado nesta consulta', description: 'Pode ter saído da lista — abra o período de novo.' };
  return {
    color: F.COR,
    title: `📦 ${F.nomeSeguro(item)} — ${F.nomeSeguro(bau)}`,
    description: [
      `**Saldo no período:** ${qtd(linha.saldo)}`,
      `**Entrou:** ${qtd(linha.guardou)}`,
      `**Saiu:** ${qtd(linha.removeu)}`,
      linha.ultima ? `**Última movimentação:** ${E.formatarDataHora(linha.ultima)}` : null,
    ].filter(Boolean).join('\n'),
    footer: { text: F.rodape('canal logs-baú') },
  };
}

function linhaEventoPessoa(e) {
  const sinal = e.acao === 'bau_guardou' ? '📥 guardou' : '📤 retirou';
  return `• ${sinal} **${qtd(e.quantidade)}× ${F.nomeSeguro(e.item)}** de ${F.nomeSeguro(E.bauDoTitulo(e.titulo) ?? 'baú')} — ${E.formatarDataHora(e.ocorrido_em)}`;
}

async function embedFichaPessoa(idFivem, nomeConhecido) {
  const dados = await repo.atividadeBauPorId(idFivem, 8);
  return {
    color: F.COR,
    title: `📦 ${F.nomeSeguro(nomeConhecido ?? idFivem)} — ATIVIDADE NO BAÚ`,
    description: [
      `**ID:** \`${idFivem}\``,
      `**Guardou (total):** ${qtd(dados.guardou)}`,
      `**Retirou (total):** ${qtd(dados.removeu)}`,
      dados.desde ? `**Desde:** ${E.formatarDataHora(dados.desde)}` : null,
      '',
      dados.eventos.length ? '**Últimos movimentos:**' : '*Nenhum movimento registrado.*',
      ...dados.eventos.map(linhaEventoPessoa),
    ].filter(Boolean).join('\n'),
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
    return interaction.reply({ components: [selectPeriodoRanking()], flags: 64 });
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
    await interaction.update(renderizarListaItens(a, atualizada));
    return;
  }

  if (interaction.isButton() && acao === 'pag') {
    const { erro } = armazem.obter(a, interaction.user.id);
    if (erro) return interaction.update({ content: mensagemErroConsulta(erro), embeds: [], components: [] });
    const atualizada = armazem.atualizar(a, { pagina: Number(b) || 0 });
    await interaction.update(renderizarListaItens(a, atualizada));
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
    // Termo só de dígitos: trata como ID de jogador direto (o log do baú não
    // guarda nome, então buscar "jogador" é sempre por ID, nunca por nome).
    if (/^\d+$/.test(termo.trim())) {
      const nomes = await repo.nomesPorIds([termo.trim()]);
      return interaction.reply({ embeds: [await embedFichaPessoa(termo.trim(), nomes.get(termo.trim()))], flags: 64 });
    }
    const resultados = buscarItens(consulta, termo);
    if (!resultados.length) {
      return interaction.reply({ content: `❌ NENHUM ITEM ENCONTRADO PARA \`${termo}\`. PRA BUSCAR JOGADOR, DIGITE SÓ O ID.`, flags: 64 });
    }
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${MODULO}:sel:${a}`)
      .setPlaceholder(`RESULTADO (${resultados.length}) — ESCOLHA O ITEM`)
      .addOptions(resultados.slice(0, 25).map(r => ({ label: r.label, value: r.valor, description: r.description })));
    return interaction.reply({ content: `🔎 BUSCA POR \`${termo}\`:`, components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
  }

  if (interaction.isStringSelectMenu() && acao === 'sel') {
    const { consulta, erro } = armazem.obter(a, interaction.user.id);
    if (erro) return interaction.reply({ content: mensagemErroConsulta(erro), flags: 64 });
    const [tipo, resto] = interaction.values[0].split(':');
    if (tipo === 'item') {
      const [bau, item] = resto.split('|');
      return interaction.reply({ embeds: [embedFichaItem(consulta, bau, item)], flags: 64 });
    }
    return interaction.reply({ content: '❌ RESULTADO DESCONHECIDO.', flags: 64 });
  }
});

module.exports = { linhaComponentesBau };
