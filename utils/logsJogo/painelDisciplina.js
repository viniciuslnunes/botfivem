const repo = require('./repositorio');
const E = require('./estatisticas');
const F = require('./painelFormato');
const A = require('./analises');
const { criarPainelCanal } = require('./painelCanal');
const { registrarConsulta, selectPeriodo } = require('./painelConsulta');

// Canal ⚖️・disciplina-jogo: a punição que acontece DENTRO do jogo — advertência
// com serviços a cumprir, e multa. O Discord tem o próprio fluxo de advertência
// (cargos ADV¹/²/³, canal de advertência); este canal é a outra metade da
// história, que até agora não era lida por ninguém.
//
// Duas coisas que só aparecem aqui e valem auditoria:
//   • quanto de SERVIÇO está pendente hoje, e de quem;
//   • quem PERDOA advertência ("REMOVEU MANUALMENTE"), que é o único evento em
//     que a liderança desfaz uma punição sem deixar rastro no Discord.
const SLUG = 'disciplina_jogo';
const HISTORICO_MAX = 4000; // eventos lidos pra reconstruir o estado atual
const TOP = 10;

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
  return `• ${F.pessoa({ nome: m.alvo_nome, id: m.alvo_id_fivem })} `
    + `por ${F.nomeSeguro(m.ator_nome)} — ${E.formatarDataHora(m.ocorrido_em)}`
    + (motivo ? `\n   *${E.truncar(F.nomeSeguro(motivo), 120)}*` : '');
}

function linhaPerdao(p) {
  return `• ${F.nomeSeguro(p.ator_nome)} perdoou ${F.pessoa({ nome: p.alvo_nome, id: p.alvo_id_fivem })}`
    + ` — ${E.formatarDataHora(p.ocorrido_em)}`;
}

function linhaTop(l, i) {
  return `${i + 1}. ${F.pessoa(l)} — ${E.formatarNumero(l.total)}`;
}

async function montarBlocos() {
  const tudo = E.resolverPeriodo('tudo');
  const mes = E.resolverPeriodo('30d');
  const [eventosAdv, multas, perdoes, topMultou, topAdvertiu, ultimaAdv, ultimaMulta] = await Promise.all([
    repo.listarPorAcoes(A.ACOES_ADVERTENCIA, tudo, HISTORICO_MAX),
    repo.listarPorAcoes(ACOES_MULTA, mes, TOP),
    repo.listarPorAcoes(['adv_removida'], mes, TOP),
    repo.topAtoresPorAcoes(ACOES_MULTA, mes, TOP),
    repo.topAtoresPorAcoes(['adv_removida'], mes, TOP),
    repo.ultimaOcorrencia(A.ACOES_ADVERTENCIA),
    repo.ultimaOcorrencia(ACOES_MULTA),
  ]);

  const ativas = A.advertenciasAtivas(eventosAdv);
  const servicosPendentes = ativas.reduce((t, a) => t + (a.servicos ?? 0), 0);
  // Advertência só vinha do canal logs-liderança (parado desde 2026-07): sem o
  // aviso, "0 abertas" pareceria "ninguém punido", quando é "ninguém sabe".
  const avisoAdv = F.avisoFonteParada(ultimaAdv);
  const avisoMulta = F.avisoFonteParada(ultimaMulta);

  const embeds = F.embedsDeLista({
    titulo: '⚖️ ADVERTÊNCIAS ABERTAS NO JOGO',
    cabecalho: [
      ...(avisoAdv ? [avisoAdv, ''] : []),
      `**${ativas.length}** ${ativas.length === 1 ? 'advertência aberta' : 'advertências abertas'}`
        + ` · **${E.formatarNumero(servicosPendentes)}** serviços pendentes no total`,
      '*Aberta = o último evento do jogador foi uma advertência; cumprir ("FINALIZOU") ou ser perdoado encerra.*',
    ].join('\n'),
    linhas: ativas.map(linhaAdvertencia),
    vazio: 'Ninguém com advertência aberta. 🎉',
    origem: 'canal logs-liderança',
  });

  const fields = [];
  if (perdoes.length) {
    fields.push({ name: 'ADVERTÊNCIAS PERDOADAS (ÚLTIMOS 30 DIAS)', value: E.truncar(perdoes.map(linhaPerdao).join('\n'), 1024) });
  }
  if (topAdvertiu.length) {
    fields.push({ name: 'QUEM MAIS PERDOOU (30 DIAS)', value: E.truncar(topAdvertiu.map(linhaTop).join('\n'), 1024) });
  }
  if (topMultou.length) {
    fields.push({ name: 'QUEM MAIS MULTOU (30 DIAS)', value: E.truncar(topMultou.map(linhaTop).join('\n'), 1024) });
  }

  embeds.push(...F.embedsDeLista({
    titulo: '💸 MULTAS — ÚLTIMOS 30 DIAS',
    cabecalho: [
      ...(avisoMulta ? [avisoMulta, ''] : []),
      'Multa aparece com o motivo que quem aplicou escreveu no jogo.',
    ].join('\n'),
    linhas: multas.map(linhaMulta),
    vazio: 'Nenhuma multa nos últimos 30 dias.',
    origem: 'canal logs-registros',
    fields,
  }));

  return F.blocosDeEmbeds(embeds);
}

function montarAcao() {
  return {
    content: '👇 **VER A DISCIPLINA DE UM PERÍODO**',
    components: [selectPeriodo(SLUG, 'ESCOLHA UM PERÍODO')],
  };
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '⚖️・disciplina-jogo',
  razao: 'Advertências, serviços e multas do jogo a partir dos logs',
  intervaloMin: 30,
  montarBlocos,
  montarAcao,
});

// No período, o que interessa é o FLUXO (quantas foram aplicadas, cumpridas e
// perdoadas), não o estado atual — esse o canal já mostra em cima.
registrarConsulta(SLUG, async periodo => {
  const [contagens, multas, perdoes] = await Promise.all([
    repo.contarPorAcoes([...A.ACOES_ADVERTENCIA, ...ACOES_MULTA], periodo),
    repo.listarPorAcoes(ACOES_MULTA, periodo, TOP),
    repo.listarPorAcoes(['adv_removida'], periodo, TOP),
  ]);
  const ROTULOS = {
    advertido: 'Advertências aplicadas',
    adv_finalizou: 'Advertências cumpridas',
    adv_removida: 'Advertências perdoadas',
    multou: 'Multas',
  };
  return {
    embeds: F.embedsDeLista({
      titulo: `⚖️ DISCIPLINA — ${periodo.rotulo}`,
      cabecalho: 'Fluxo do período (o estado atual fica no topo do canal).',
      linhas: contagens.map(c => `• **${ROTULOS[c.acao] ?? c.acao}:** ${E.formatarNumero(c.total)}`),
      vazio: 'Nenhum evento de disciplina no período.',
      origem: 'canais logs-registros (multa) e logs-liderança (advertência)',
      fields: [
        ...(multas.length ? [{ name: 'MULTAS DO PERÍODO', value: E.truncar(multas.map(linhaMulta).join('\n'), 1024) }] : []),
        ...(perdoes.length ? [{ name: 'PERDÕES DO PERÍODO', value: E.truncar(perdoes.map(linhaPerdao).join('\n'), 1024) }] : []),
      ],
    }).slice(0, 1),
  };
}, painel.agendarAtualizacaoReativa);

module.exports = {
  iniciarPainelDisciplina: painel.iniciar,
  atualizarPainelDisciplina: painel.atualizar,
  agendarAtualizacaoReativa: painel.agendarAtualizacaoReativa,
};
