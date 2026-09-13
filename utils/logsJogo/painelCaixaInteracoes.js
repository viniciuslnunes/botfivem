const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const E = require('./estatisticas');
const F = require('./painelFormato');
const repo = require('./repositorio');
const { selectPeriodo, selectBuscarJogador, linhaBotao } = require('./painelComponentesFixos');

// Canal 🏦・caixa-do-jogo: mesmo padrão interativo do 📦・estoque-bau (ver
// docs/inteligencia-logs-jogo.md § "Padrão de UI"). Aqui não existe uma LISTA
// pra paginar — é dinheiro e honra agregados —, então o select de período abre
// direto o resumo do período (dois embeds: dinheiro e honra), sem paginação.
const MODULO = 'caixa';

// Moedas que nunca se somam (ver painelCaixa.js) — únicas o bastante pra
// ficarem aqui, fonte de verdade pras duas telas (resumo fixo e interativo).
const DINHEIRO_ENTRA = ['banco_depositou', 'dinheiro_conquista', 'dinheiro_adicionado'];
const DINHEIRO_SAI = ['banco_sacou'];
const DINHEIRO = [...DINHEIRO_ENTRA, ...DINHEIRO_SAI];
const HONRA = ['honra_adicionada', 'honra_gastou'];
const ROUPA = ['comprou_roupa'];
const ACOES_TODAS = [...DINHEIRO, ...HONRA, ...ROUPA];

const ROTULOS = {
  banco_depositou: '🔵 Depósitos de sócios',
  dinheiro_conquista: '🔵 Prêmio de conquista de território',
  dinheiro_adicionado: '🟡 Dinheiro posto pela staff',
  banco_sacou: '🔴 Saques',
  honra_adicionada: '🎖️ Honra recebida',
  honra_gastou: '🎖️ Honra gasta',
  comprou_roupa: '👕 Roupa (R$ do bolso do sócio)',
};

function somaDe(linhas, acoes) {
  return linhas.filter(l => acoes.includes(l.acao)).reduce((t, l) => t + Number(l.soma), 0);
}

function totalDe(linhas, acoes) {
  return linhas.filter(l => acoes.includes(l.acao)).reduce((t, l) => t + Number(l.total), 0);
}

function moeda(acao, valor) {
  return HONRA.includes(acao) ? `${E.formatarNumero(valor)} de honra` : E.formatarDinheiro(valor);
}

function linhaResumo(l) {
  return `${ROTULOS[l.acao] ?? l.acao} — **${moeda(l.acao, l.soma)}** em ${E.formatarNumero(l.total)} ${l.total === 1 ? 'registro' : 'registros'}`;
}

function linhaPessoaValor(l, i) {
  return `${i + 1}. ${F.pessoa(l)} — ${E.formatarDinheiro(l.soma)} (${E.formatarNumero(l.total)}×)`;
}

function linhaMovimento(l) {
  const quando = E.formatarDataHora(l.ocorrido_em);
  if (l.acao === 'dinheiro_conquista') return `🔵 conquista de **${F.nomeSeguro(l.alvo_nome)}** rendeu **${E.formatarDinheiro(l.valor)}** — ${quando}`;
  const quem = F.pessoa({ nome: l.ator_nome, id: l.ator_id_fivem });
  if (l.acao === 'dinheiro_adicionado') return `🟡 staff ${quem} pôs **${E.formatarDinheiro(l.valor)}** — ${quando}`;
  if (l.acao.startsWith('honra')) return `🎖️ ${quem} ${l.acao === 'honra_gastou' ? `gastou **${E.formatarNumero(l.valor)}** em ${F.nomeSeguro(l.alvo_nome ?? 'item')}` : `recebeu **${E.formatarNumero(l.valor)}**`} — ${quando}`;
  if (l.acao === 'comprou_roupa') return `👕 ${quem} gastou **${E.formatarDinheiro(l.valor)}** em roupa — ${quando}`;
  const entrou = l.acao === 'banco_depositou';
  return `${entrou ? '🔵' : '🔴'} ${quem} ${entrou ? 'depositou' : 'sacou'} **${E.formatarDinheiro(l.valor)}** — ${quando}`;
}

function cabecalhoDinheiro(somas, rotulo, aviso) {
  const entrou = somaDe(somas, DINHEIRO_ENTRA);
  const saiu = somaDe(somas, DINHEIRO_SAI);
  const liquido = entrou - saiu;
  return [
    ...(aviso ? [aviso, ''] : []),
    `**${rotulo}**`,
    `🔵 Entrou: **${E.formatarDinheiro(entrou)}** (${E.formatarNumero(totalDe(somas, DINHEIRO_ENTRA))} registros)`,
    `🔴 Saiu: **${E.formatarDinheiro(saiu)}** (${E.formatarNumero(totalDe(somas, DINHEIRO_SAI))} saques)`,
    `${liquido >= 0 ? '▲' : '▼'} Líquido: **${E.formatarDinheiro(liquido)}**`,
    '',
    '*Movimento do período, não o saldo da conta — o jogo só publica entrada e saída.*',
  ].join('\n');
}

async function dadosDoPeriodo(periodo) {
  const [somas, topDeposito, topSaque, movimentos, honraGasta, ultima] = await Promise.all([
    repo.somarPorAcoes(ACOES_TODAS, periodo),
    repo.topAtoresPorValor(['banco_depositou'], periodo, 10).then(F.comNomes),
    repo.topAtoresPorValor(DINHEIRO_SAI, periodo, 10).then(F.comNomes),
    repo.listarPorAcoes(DINHEIRO, periodo, 10).then(l => F.comNomes(l, { id: 'ator_id_fivem', nome: 'ator_nome' })),
    repo.listarPorAcoes(['honra_gastou'], periodo, 10).then(l => F.comNomes(l, { id: 'ator_id_fivem', nome: 'ator_nome' })),
    repo.ultimaOcorrencia(DINHEIRO),
  ]);
  return { somas, topDeposito, topSaque, movimentos, honraGasta, ultima };
}

function embedDinheiro(periodo, d) {
  const fields = [];
  if (d.movimentos.length) fields.push({ name: 'ÚLTIMAS MOVIMENTAÇÕES', value: E.truncar(d.movimentos.map(linhaMovimento).join('\n'), 1024) });
  if (d.topSaque.length) fields.push({ name: '🔴 QUEM SACOU', value: E.truncar(d.topSaque.map(linhaPessoaValor).join('\n'), 1024) });
  if (d.topDeposito.length) fields.push({ name: '🔵 QUEM MAIS DEPOSITOU', value: E.truncar(d.topDeposito.map(linhaPessoaValor).join('\n'), 1024) });
  const doDinheiro = d.somas.filter(l => DINHEIRO.includes(l.acao));
  return {
    color: F.COR,
    title: `🏦 BANCO DA TORCIDA — ${periodo.rotulo}`,
    description: [cabecalhoDinheiro(d.somas, periodo.rotulo, F.avisoFonteParada(d.ultima)), '', doDinheiro.map(linhaResumo).join('\n') || '*Sem movimento.*'].join('\n'),
    fields,
    footer: { text: F.rodape('canal logs-banco') },
  };
}

function embedHonraGasto(periodo, d) {
  const recebida = somaDe(d.somas, ['honra_adicionada']);
  const gasta = somaDe(d.somas, ['honra_gastou']);
  return {
    color: F.COR,
    title: `🎖️ HONRA — ${periodo.rotulo}`,
    description: `Recebida: **${E.formatarNumero(recebida)}** · Gasta: **${E.formatarNumero(gasta)}**\n*Honra é moeda própria: não se soma com dinheiro.*\n\n`
      + (d.honraGasta.length ? d.honraGasta.map(l => `• ${F.pessoa({ nome: l.ator_nome, id: l.ator_id_fivem })} gastou **${E.formatarNumero(l.valor)}** em **${F.nomeSeguro(l.alvo_nome ?? 'item')}** — ${E.formatarDataHora(l.ocorrido_em)}`).join('\n') : '*Ninguém gastou honra no período.*'),
    footer: { text: F.rodape('canal logs-banco') },
  };
}

async function abrirCaixa(interaction, periodo) {
  const dados = await dadosDoPeriodo(periodo);
  await interaction.editReply({ embeds: [embedDinheiro(periodo, dados), embedHonraGasto(periodo, dados)] });
}

// ── Ranking ──────────────────────────────────────────────────────────────────

function linhaRankingValor(l, i) {
  return `${i + 1}. ${F.pessoa(l)} — ${E.formatarDinheiro(l.soma)} (${E.formatarNumero(l.total)}×)`;
}

async function embedRanking(periodo) {
  const [topDeposito, topSaque, topHonra] = await Promise.all([
    repo.topAtoresPorValor(['banco_depositou'], periodo, 10).then(F.comNomes),
    repo.topAtoresPorValor(DINHEIRO_SAI, periodo, 10).then(F.comNomes),
    repo.topAtoresPorValor(['honra_gastou'], periodo, 10).then(F.comNomes),
  ]);
  return {
    color: F.COR,
    title: `🏆 RANKING DO CAIXA — ${periodo.rotulo}`,
    fields: [
      { name: '🔵 QUEM MAIS DEPOSITOU', value: topDeposito.map(linhaRankingValor).join('\n') || '*Sem dados.*' },
      { name: '🔴 QUEM MAIS SACOU', value: topSaque.map(linhaRankingValor).join('\n') || '*Sem dados.*' },
      { name: '🎖️ QUEM MAIS GASTOU HONRA', value: topHonra.map(linhaRankingValor).join('\n') || '*Sem dados.*' },
    ],
    footer: { text: F.rodape('canal logs-banco') },
    timestamp: new Date().toISOString(),
  };
}

// ── Ficha de jogador ─────────────────────────────────────────────────────────

async function embedFichaJogador(idFivem, nomeConhecido) {
  const eventos = await repo.eventosDoAtor(idFivem, ACOES_TODAS, 8);
  const depositou = await repo.somarPorAcoes(['banco_depositou'], E.resolverPeriodo('tudo'));
  return {
    color: F.COR,
    title: `🏦 ${F.nomeSeguro(nomeConhecido ?? idFivem)} — CAIXA`,
    description: [
      `**ID:** \`${idFivem}\``,
      depositou[0] ? `**Depositado (total):** ${E.formatarDinheiro(depositou[0].soma)} em ${E.formatarNumero(depositou[0].total)}×` : null,
      '',
      eventos.length ? '**Últimos movimentos:**' : '*Nenhum movimento registrado.*',
      ...eventos.map(linhaMovimento),
    ].filter(Boolean).join('\n'),
    footer: { text: F.rodape('canais logs-banco e logs-liderança') },
  };
}

function linhaComponentesCaixa() {
  return [
    selectPeriodo(MODULO),
    selectBuscarJogador(MODULO),
    linhaBotao(MODULO, 'ranking', 'RANKING', { emoji: '🏆' }),
  ];
}

registrarModulo(MODULO, async interaction => {
  const acao = interaction.customId.split(':')[1];

  if (interaction.isStringSelectMenu() && acao === 'selperiodo') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    await abrirCaixa(interaction, E.resolverPeriodo(interaction.values[0]));
    return;
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
});

module.exports = { linhaComponentesCaixa, DINHEIRO, HONRA, ROUPA, ACOES_TODAS, cabecalhoDinheiro, linhaResumo };
