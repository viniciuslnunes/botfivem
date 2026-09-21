const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const E = require('./estatisticas');
const F = require('./painelFormato');
const A = require('./analises');
const repo = require('./repositorio');
const { selectPeriodo, selectBuscarJogador } = require('./painelComponentesFixos');
const { linhaAdvertenciaDiscord } = require('./advertenciaDiscord');

// Canal ⚖️・disciplina-jogo: mesmo padrão interativo do 📦・estoque-bau.
// Estado atual (advertências/serviços abertos) já sai na mensagem fixa —
// aqui só ficam BUSCAR JOGADOR (ficha) e o select de período (FLUXO: quantas
// foram aplicadas/cumpridas/perdoadas/multas num recorte de tempo).
const MODULO = 'disciplina';
const ACOES_MULTA = ['multou'];

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
    description: 'Fluxo do período (o estado atual fica na mensagem fixa do canal).',
    fields: [
      ...F.campoLista('POR TIPO', contagens.map(c => `• **${ROTULOS[c.acao] ?? c.acao}:** ${E.formatarNumero(c.total)}`), 'Nenhum evento no período.'),
      ...(multas.length ? [{ name: 'MULTAS DO PERÍODO', value: E.truncar(multas.map(linhaMulta).join('\n'), 1024) }] : []),
      ...(perdoes.length ? [{ name: 'PERDÕES DO PERÍODO', value: E.truncar(perdoes.map(linhaPerdao).join('\n'), 1024) }] : []),
    ],
    footer: { text: F.rodape('canal logs-registros') },
  };
}

// ── Ficha de jogador ─────────────────────────────────────────────────────────

async function embedFichaJogador(idFivem, nomeConhecido, membro) {
  const eventos = await repo.eventosDoAlvo(idFivem, [...A.ACOES_ADVERTENCIA, ...ACOES_MULTA], 300);
  const advertencias = eventos.filter(e => A.ACOES_ADVERTENCIA.includes(e.acao));
  const aberta = advertencias[0]?.acao === 'advertido' ? advertencias[0] : null;
  const multas = eventos.filter(e => e.acao === 'multou');
  return {
    color: F.COR,
    title: `⚖️ ${F.nomeSeguro(nomeConhecido ?? idFivem)} — DISCIPLINA`,
    description: [
      `**ID:** \`${idFivem}\``,
      linhaAdvertenciaDiscord(membro),
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
    selectBuscarJogador(MODULO),
    selectPeriodo(MODULO, { placeholder: 'VER FLUXO DE UM PERÍODO' }),
  ];
}

registrarModulo(MODULO, async interaction => {
  const [, acao] = interaction.customId.split(':');

  if (interaction.isUserSelectMenu() && acao === 'buscarjogador') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const membro = interaction.members.first();
    const idFivem = E.idFivemDoNick(membro?.nickname ?? membro?.displayName);
    if (!idFivem) {
      return interaction.reply({ content: `❌ ${membro ?? 'ESSE MEMBRO'} NÃO TEM ID DO JOGO NO APELIDO (PADRÃO "... - 1234").`, flags: 64, allowedMentions: { parse: [] } });
    }
    await interaction.deferReply({ flags: 64 });
    await interaction.editReply({ embeds: [await embedFichaJogador(idFivem, membro.displayName, membro)] });
    return;
  }

  if (interaction.isStringSelectMenu() && acao === 'selperiodo') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    await interaction.editReply({ embeds: [await embedFluxo(E.resolverPeriodo(interaction.values[0]))] });
    return;
  }
});

module.exports = { linhaComponentesDisciplina, linhaMulta, linhaTop, embedFichaJogador };
