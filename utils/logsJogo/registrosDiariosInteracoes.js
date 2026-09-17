const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { registrarModulo } = require('../modulos');
const relatorios = require('./relatorios');

// Lista de jogadores do registro diário deixou de morar na mensagem do canal
// (ver registrosDiarios.js) — uma description gigante e cheia de markdown
// (100-200 linhas em negrito) se mostrou frágil contra bug de renderização
// do PRÓPRIO CLIENTE do Discord: o texto guardado no servidor sempre saiu
// completo (auditado direto pela API, byte a byte), mas o Discord ocasional-
// mente "comia" o fim de uma linha na tela do usuário — sempre em posição
// diferente, sem relação com o dado. Mesmo padrão já usado com sucesso nos
// outros canais de log (painel-jogadores, disciplina etc.): mensagem fixa
// curta (resumo) + exploração ephemeral, paginada em blocos pequenos que o
// Discord renderiza sem problema.
const MODULO = 'registrodia';
const POR_PAGINA = 25;
const TTL_MS = 15 * 60 * 1000;
const cache = new Map(); // dia -> { entradas, criadoEm }

function limparExpirados() {
  const agora = Date.now();
  for (const [dia, c] of cache) if (agora - c.criadoEm > TTL_MS) cache.delete(dia);
}

// Dias já fechados nunca mudam — uma vez em cache, fica até expirar (só pra
// não recalcular a cada clique). O dia em andamento pode crescer entre um
// clique e outro, então o cache dele também expira pelo mesmo TTL do painel
// de presença ao vivo.
async function entradasDoDia(dia) {
  limparExpirados();
  const existente = cache.get(dia);
  if (existente) return existente.entradas;
  const { periodoDoDia } = require('./registrosDiarios');
  const dados = await relatorios.montarDadosPresenca(periodoDoDia(dia), { listaCumulativa: true, semContextoGlobal: true });
  cache.set(dia, { entradas: dados.entradas, criadoEm: Date.now() });
  return dados.entradas;
}

function botaoVerJogadores(dia) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${MODULO}:ver:${dia}`).setLabel('📋 VER JOGADORES').setStyle(ButtonStyle.Secondary)
  );
}

function renderizarPagina(dia, entradas, pagina) {
  const { tituloDia, linhaJogador } = require('./registrosDiarios');
  const total = entradas.length;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const atual = Math.min(Math.max(0, pagina), totalPaginas - 1);
  const fatia = entradas.slice(atual * POR_PAGINA, (atual + 1) * POR_PAGINA);
  const linhas = fatia.map((e, i) => linhaJogador(e, atual * POR_PAGINA + i));

  const embed = {
    color: 0x000000,
    title: `📅 JOGADORES — ${tituloDia(dia)}`,
    description: linhas.join('\n') || '*Ninguém online registrado.*',
    footer: { text: `Com base nos logs do jogo recebidos pelo webhook · canal logs-painel · Página ${atual + 1}/${totalPaginas}` },
  };
  const botoes = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${MODULO}:pag:${dia}:${atual - 1}`)
      .setLabel(atual > 0 ? `◀ ANTERIOR (${atual}/${totalPaginas})` : '◀ ANTERIOR')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atual === 0),
    new ButtonBuilder()
      .setCustomId(`${MODULO}:pag:${dia}:${atual + 1}`)
      .setLabel(atual < totalPaginas - 1 ? `PRÓXIMA ▶ (${atual + 2}/${totalPaginas})` : 'PRÓXIMA ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atual >= totalPaginas - 1)
  );
  return { embeds: [embed], components: [botoes] };
}

registrarModulo(MODULO, async interaction => {
  if (!interaction.isButton()) return;
  const [, acao, dia, paginaStr] = interaction.customId.split(':');

  if (acao === 'ver') {
    await interaction.deferReply({ flags: 64 });
    const entradas = await entradasDoDia(dia);
    return interaction.editReply(renderizarPagina(dia, entradas, 0));
  }

  if (acao === 'pag') {
    await interaction.deferUpdate();
    const entradas = await entradasDoDia(dia);
    return interaction.editReply(renderizarPagina(dia, entradas, parseInt(paginaStr, 10)));
  }
});

module.exports = { botaoVerJogadores };
