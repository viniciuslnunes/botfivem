const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder,
} = require('discord.js');
const { PERIODOS } = require('./painelConsulta');

// Blocos de componente que se repetem na mensagem fixa de todo canal-painel
// interativo (ver docs/inteligencia-logs-jogo.md § "Padrão de UI"). Cada
// módulo (`painelXInteracoes.js`) monta a própria combinação de linhas com
// isto — não reescrever ActionRowBuilder/StringSelectMenuBuilder cru em cada
// arquivo novo.

// Select de período — abre a exploração por janela de tempo. `acao` deixa
// dois selects de período convivirem no mesmo módulo (ex.: um pra abrir a
// lista, outro só pro ranking), como o botão RANKING do painel de jogadores
// já fazia.
function selectPeriodo(modulo, { acao = 'selperiodo', placeholder = 'ESCOLHA UM PERÍODO' } = {}) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${modulo}:${acao}`)
      .setPlaceholder(placeholder)
      .addOptions(PERIODOS.map(p => ({ label: p.label, value: p.chave })))
  );
}

// UserSelect nativo do Discord pra abrir a ficha de um jogador direto, sem
// escolher período/filtro antes — resolve o ID do jogo a partir do apelido
// (padrão "... - 1234"), igual ao painel de jogadores.
function selectBuscarJogador(modulo, { acao = 'buscarjogador', placeholder = '🔎 BUSCAR JOGADOR (DISCORD)' } = {}) {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder().setCustomId(`${modulo}:${acao}`).setPlaceholder(placeholder)
  );
}

// Botão simples (ex.: RANKING, VER ATIVOS) — uma linha com um só, ou monte a
// ActionRowBuilder na mão quando precisar de mais de um botão na mesma linha.
function linhaBotao(modulo, acao, label, { emoji, style = ButtonStyle.Secondary } = {}) {
  const botao = new ButtonBuilder().setCustomId(`${modulo}:${acao}`).setLabel(label).setStyle(style);
  if (emoji) botao.setEmoji(emoji);
  return new ActionRowBuilder().addComponents(botao);
}

// Botões ◀ ANTERIOR / PRÓXIMA ▶ / 🔎 BUSCAR de uma lista paginada — mesmo
// texto e mesma lógica de desabilitar na ponta em todo canal-painel.
function linhaPaginacao(modulo, consultaId, atual, totalPaginas, { comBusca = true } = {}) {
  const temAnterior = atual > 0;
  const temProxima = atual < totalPaginas - 1;
  const botoes = [
    new ButtonBuilder()
      .setCustomId(`${modulo}:pag:${consultaId}:${atual - 1}`)
      .setLabel(temAnterior ? `◀ ANTERIOR (${atual}/${totalPaginas})` : '◀ ANTERIOR')
      .setStyle(ButtonStyle.Secondary).setDisabled(!temAnterior),
    new ButtonBuilder()
      .setCustomId(`${modulo}:pag:${consultaId}:${atual + 1}`)
      .setLabel(temProxima ? `PRÓXIMA ▶ (${atual + 2}/${totalPaginas})` : 'PRÓXIMA ▶')
      .setStyle(ButtonStyle.Secondary).setDisabled(!temProxima),
  ];
  if (comBusca) botoes.push(new ButtonBuilder().setCustomId(`${modulo}:buscar:${consultaId}`).setLabel('🔎 BUSCAR').setStyle(ButtonStyle.Secondary));
  return new ActionRowBuilder().addComponents(botoes);
}

module.exports = { selectPeriodo, selectBuscarJogador, linhaBotao, linhaPaginacao };
