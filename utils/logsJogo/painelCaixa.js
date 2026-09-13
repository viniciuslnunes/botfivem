const repo = require('./repositorio');
const E = require('./estatisticas');
const F = require('./painelFormato');
const { criarPainelCanal } = require('./painelCanal');
const { registrarConsulta, selectPeriodo } = require('./painelConsulta');

// Canal 🏦・caixa-do-jogo: o dinheiro e a honra da torcida nos logs do jogo.
//
// Moedas diferentes nunca se somam, e o painel separa:
//   • DINHEIRO DO BANCO DA TORCIDA — depósito, saque, prêmio de conquista e
//     dinheiro posto pela staff. Vem do canal logs-banco (e, até 2026-07, do
//     logs-liderança, que parou). Saque é o evento de risco: tem alerta próprio
//     (alertas.js) e ranking de quem saca.
//   • HONRA — recebida e gasta em item da torcida (slot de tag, veículo VIP,
//     material). Também do logs-banco.
//   • ROUPA — R$ do bolso do próprio sócio, só no logs-liderança (histórico).
// Coins de território ficam no painel de território, não aqui.
//
// O jogo não publica SALDO de nada, só movimentação: todo número aqui é movimento
// do período, e o painel diz isso.
const SLUG = 'caixa_jogo';
const TOP = 10;

const DINHEIRO_ENTRA = ['banco_depositou', 'dinheiro_conquista', 'dinheiro_adicionado'];
const DINHEIRO_SAI = ['banco_sacou'];
const DINHEIRO = [...DINHEIRO_ENTRA, ...DINHEIRO_SAI];
const HONRA = ['honra_adicionada', 'honra_gastou'];
const ROUPA = ['comprou_roupa'];
const ACOES_TODAS = [...DINHEIRO, ...HONRA, ...ROUPA];

const ROTULOS = {
  banco_depositou: '🟢 Depósitos de sócios',
  dinheiro_conquista: '🟢 Prêmio de conquista de território',
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
  if (l.acao === 'dinheiro_conquista') {
    return `🟢 conquista de **${F.nomeSeguro(l.alvo_nome)}** rendeu **${E.formatarDinheiro(l.valor)}** — ${quando}`;
  }
  const quem = F.pessoa({ nome: l.ator_nome, id: l.ator_id_fivem });
  if (l.acao === 'dinheiro_adicionado') return `🟡 staff ${quem} pôs **${E.formatarDinheiro(l.valor)}** — ${quando}`;
  const entrou = l.acao === 'banco_depositou';
  return `${entrou ? '🟢' : '🔴'} ${quem} ${entrou ? 'depositou' : 'sacou'} **${E.formatarDinheiro(l.valor)}** — ${quando}`;
}

function linhaHonraGasta(l) {
  return `• ${F.pessoa({ nome: l.ator_nome, id: l.ator_id_fivem })} gastou **${E.formatarNumero(l.valor)}** em `
    + `**${F.nomeSeguro(l.alvo_nome ?? 'item')}** — ${E.formatarDataHora(l.ocorrido_em)}`;
}

function cabecalhoDinheiro(somas, rotulo, aviso) {
  const entrou = somaDe(somas, DINHEIRO_ENTRA);
  const saiu = somaDe(somas, DINHEIRO_SAI);
  const liquido = entrou - saiu;
  return [
    ...(aviso ? [aviso, ''] : []),
    `**${rotulo}**`,
    `🟢 Entrou: **${E.formatarDinheiro(entrou)}** (${E.formatarNumero(totalDe(somas, DINHEIRO_ENTRA))} registros)`,
    `🔴 Saiu: **${E.formatarDinheiro(saiu)}** (${E.formatarNumero(totalDe(somas, DINHEIRO_SAI))} saques)`,
    `${liquido >= 0 ? '📈' : '📉'} Líquido: **${E.formatarDinheiro(liquido)}**`,
    '',
    '*Movimento do período, não o saldo da conta — o jogo só publica entrada e saída.*',
  ].join('\n');
}

async function dadosDoPeriodo(periodo) {
  const [somas, porDia, topDeposito, topSaque, movimentos, honraGasta, ultima] = await Promise.all([
    repo.somarPorAcoes(ACOES_TODAS, periodo),
    repo.contarPorDiaPorAcoes(DINHEIRO, periodo),
    repo.topAtoresPorValor(['banco_depositou'], periodo, TOP).then(F.comNomes),
    repo.topAtoresPorValor(DINHEIRO_SAI, periodo, TOP).then(F.comNomes),
    repo.listarPorAcoes(DINHEIRO, periodo, 10).then(l => F.comNomes(l, { id: 'ator_id_fivem', nome: 'ator_nome' })),
    repo.listarPorAcoes(['honra_gastou'], periodo, 10).then(l => F.comNomes(l, { id: 'ator_id_fivem', nome: 'ator_nome' })),
    repo.ultimaOcorrencia(DINHEIRO),
  ]);
  return { somas, porDia, topDeposito, topSaque, movimentos, honraGasta, ultima };
}

function embedDinheiro(periodo, d) {
  const inicioSerie = periodo.inicio ?? (d.porDia[0] ? `${d.porDia[0].dia}T00:00:00-03:00` : periodo.fim);
  const serie = E.serieDiaria(d.porDia, inicioSerie, periodo.fim);
  const fields = [];
  if (d.movimentos.length) fields.push({ name: 'ÚLTIMAS MOVIMENTAÇÕES', value: E.truncar(d.movimentos.map(linhaMovimento).join('\n'), 1024) });
  if (d.topSaque.length) fields.push({ name: '🔴 QUEM SACOU', value: E.truncar(d.topSaque.map(linhaPessoaValor).join('\n'), 1024) });
  if (d.topDeposito.length) fields.push({ name: '🟢 QUEM MAIS DEPOSITOU', value: E.truncar(d.topDeposito.map(linhaPessoaValor).join('\n'), 1024) });

  const doDinheiro = d.somas.filter(l => DINHEIRO.includes(l.acao));
  return F.embedsDeLista({
    titulo: `🏦 BANCO DA TORCIDA — ${periodo.rotulo}`,
    cabecalho: cabecalhoDinheiro(d.somas, periodo.rotulo, F.avisoFonteParada(d.ultima)),
    linhas: [
      ...doDinheiro.map(linhaResumo),
      ...(serie.length > 1 && doDinheiro.length ? ['', `\`${E.sparkline(serie.map(x => x.total))}\``,
        `${E.formatarDiaCurto(serie[0].dia)} → ${E.formatarDiaCurto(serie[serie.length - 1].dia)} (movimentações por dia)`] : []),
    ],
    vazio: 'Nenhuma movimentação de dinheiro no período.',
    origem: 'canal logs-banco',
    fields,
  })[0];
}

function embedHonra(periodo, d) {
  const recebida = somaDe(d.somas, ['honra_adicionada']);
  const gasta = somaDe(d.somas, ['honra_gastou']);
  return F.embedsDeLista({
    titulo: `🎖️ HONRA — ${periodo.rotulo}`,
    cabecalho: `Recebida: **${E.formatarNumero(recebida)}** · Gasta: **${E.formatarNumero(gasta)}**\n*Honra é moeda própria: não se soma com dinheiro.*`,
    linhas: d.honraGasta.map(linhaHonraGasta),
    vazio: 'Ninguém gastou honra no período.',
    origem: 'canal logs-banco',
  })[0];
}

// O canal mostra a janela de 30 dias (dinheiro e honra) mais o acumulado de tudo;
// outro recorte é pergunta do select.
async function montarBlocos() {
  const mes = E.resolverPeriodo('30d');
  const tudo = E.resolverPeriodo('tudo');
  const [dadosMes, somasTudo, ultimaRoupa] = await Promise.all([
    dadosDoPeriodo(mes),
    repo.somarPorAcoes(ACOES_TODAS, tudo),
    repo.ultimaOcorrencia(ROUPA),
  ]);

  const avisoRoupa = F.avisoFonteParada(ultimaRoupa);
  const embeds = [
    embedDinheiro(mes, dadosMes),
    embedHonra(mes, dadosMes),
    ...F.embedsDeLista({
      titulo: '🏦 TODO O HISTÓRICO',
      cabecalho: cabecalhoDinheiro(somasTudo, 'DESDE O PRIMEIRO LOG LIDO', null),
      linhas: [
        ...somasTudo.map(linhaResumo),
        ...(avisoRoupa && somasTudo.some(l => ROUPA.includes(l.acao))
          ? ['', `*👕 Roupa só aparecia no canal logs-liderança — ${avisoRoupa.replace(/^⚠️ /, '')}*`]
          : []),
      ],
      vazio: 'Nenhum registro de dinheiro.',
      origem: 'canais logs-banco e logs-liderança',
    }),
  ];
  return F.blocosDeEmbeds(embeds);
}

function montarAcao() {
  return {
    content: '👇 **VER O CAIXA DE OUTRO PERÍODO**',
    components: [selectPeriodo(SLUG, 'ESCOLHA UM PERÍODO')],
  };
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '🏦・caixa-do-jogo',
  razao: 'Dinheiro e honra da torcida a partir dos logs do jogo',
  intervaloMin: 60,
  montarBlocos,
  montarAcao,
});

// Uma mensagem ephemeral aceita 6.000 caracteres somando todos os embeds: vai só
// o de dinheiro (o total de honra do período já aparece no resumo dele).
registrarConsulta(SLUG, async periodo => {
  const dados = await dadosDoPeriodo(periodo);
  return { embeds: [embedDinheiro(periodo, dados)] };
}, painel.agendarAtualizacaoReativa);

module.exports = {
  iniciarPainelCaixa: painel.iniciar,
  atualizarPainelCaixa: painel.atualizar,
  agendarAtualizacaoReativa: painel.agendarAtualizacaoReativa,
};
