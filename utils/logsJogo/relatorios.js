const config = require('../../config/index.js');
const repo = require('./repositorio');
const E = require('./estatisticas');
const P = require('./presenca');

// Embeds de estatística, compartilhados por /estatisticas e pelo painel fixo.

const COR = 0x000000;
const RODAPE = 'Com base nos logs do jogo recebidos pelo webhook';
// O painel do jogo e o ranking do próprio jogo às vezes não batem com o que o
// webhook registrou (ver picoHistoricoRegistrado) — avisar em vez de deixar
// parecer que os números deveriam ser idênticos.
const AVISO_DIVERGENCIA = 'os números podem divergir do painel e do jogo por causa de inconsistências nos logs';
const LIMITE_SESSAO_MS = config.logsJogo.presencaSessaoMaxHoras * 60 * 60 * 1000;
const FOLGA_RECONEXAO_MS = config.logsJogo.presencaReconexaoFolgaMin * 60 * 1000;

function listaTop(linhas, formatar) {
  if (!linhas.length) return '*Sem dados no período.*';
  return E.truncar(linhas.map((l, i) => `${i + 1}. ${formatar(l)}`).join('\n'), 1024);
}

function rotuloPessoa(l) {
  if (l.nome) return `${l.nome}${l.id ? ` (${l.id})` : ''}`;
  return l.id ?? '?';
}

async function coletar(filtroBase, periodo) {
  const filtroAtual = { ...filtroBase, inicio: periodo.inicio, fim: periodo.fim };
  const [atual, porDia, anterior] = await Promise.all([
    repo.resumo(filtroAtual),
    repo.contarPorDia(filtroAtual),
    periodo.anteriorInicio
      ? repo.resumo({ ...filtroBase, inicio: periodo.anteriorInicio, fim: periodo.anteriorFim })
      : Promise.resolve(null),
  ]);
  const inicioSerie = periodo.inicio ?? atual.primeira_em ?? periodo.fim;
  return { filtroAtual, atual, anterior, serie: E.serieDiaria(porDia, inicioSerie, periodo.fim) };
}

function descricaoResumo({ atual, anterior, serie }) {
  const variacao = anterior ? E.variacao(atual.total, anterior.total) : null;
  const linhas = [
    `**Registros:** ${E.formatarNumero(atual.total)}${variacao ? ` · ${variacao}` : ''}`,
    `**Pessoas distintas:** ${E.formatarNumero(atual.pessoas)}`,
  ];
  if (atual.valor_total > 0) linhas.push(`**Dinheiro do jogo movimentado:** ${E.formatarDinheiro(atual.valor_total)}`);
  linhas.push(`**Dias com atividade:** ${serie.filter(d => d.total > 0).length}/${serie.length}`);
  // Sem registro não há tendência para desenhar: dizer "parado" em vez de inventar
  if (atual.total === 0) {
    linhas.push('', '*Parado: nenhum registro no período.*');
  } else {
    linhas.push('', `\`${E.sparkline(serie.map(d => d.total))}\``,
      `${E.formatarDiaCurto(serie[0].dia)} → ${E.formatarDiaCurto(serie[serie.length - 1].dia)}`);
  }
  return linhas.join('\n');
}

async function montarEmbedTorcida(periodo) {
  const dados = await coletar({}, periodo);
  const [categorias, acoes, atores] = await Promise.all([
    repo.topCategorias(dados.filtroAtual, 5),
    repo.topAcoes(dados.filtroAtual, 5),
    repo.topAtores(dados.filtroAtual, 10),
  ]);
  return {
    color: COR,
    title: `📊 ESTATÍSTICAS DA TORCIDA — ${periodo.rotulo}`,
    description: descricaoResumo(dados),
    fields: [
      { name: 'CATEGORIAS', value: listaTop(categorias, l => `\`${l.chave}\` — ${E.formatarNumero(l.total)}`), inline: true },
      { name: 'AÇÕES', value: listaTop(acoes, l => `${l.chave} — ${E.formatarNumero(l.total)}`), inline: true },
      { name: 'MAIS ATIVOS', value: listaTop(atores, l => `${rotuloPessoa(l)} — ${E.formatarNumero(l.total)}`), inline: false },
    ],
    footer: { text: RODAPE },
    timestamp: new Date().toISOString(),
  };
}

async function montarEmbedMembro(idFivem, rotulo, periodo) {
  const dados = await coletar({ idFivem }, periodo);
  const [acoes, categorias, historico] = await Promise.all([
    repo.topAcoes(dados.filtroAtual, 5),
    repo.topCategorias(dados.filtroAtual, 5),
    repo.resumo({ idFivem }),
  ]);
  const ultima = historico.ultima_em
    ? `<t:${Math.floor(new Date(historico.ultima_em).getTime() / 1000)}:R>`
    : 'Nenhuma registrada';
  return {
    color: COR,
    title: `📊 ${rotulo} — ${periodo.rotulo}`,
    description: descricaoResumo(dados),
    fields: [
      { name: 'AÇÕES', value: listaTop(acoes, l => `${l.chave} — ${E.formatarNumero(l.total)}`), inline: true },
      { name: 'CATEGORIAS', value: listaTop(categorias, l => `\`${l.chave}\` — ${E.formatarNumero(l.total)}`), inline: true },
      { name: 'ÚLTIMA ATIVIDADE', value: ultima, inline: false },
    ],
    footer: { text: RODAPE },
    timestamp: new Date().toISOString(),
  };
}

async function montarEmbedCategoria(categoria, periodo) {
  const dados = await coletar({ categoria }, periodo);
  const [acoes, atores] = await Promise.all([
    repo.topAcoes(dados.filtroAtual, 5),
    repo.topAtores(dados.filtroAtual, 10),
  ]);
  return {
    color: COR,
    title: `📊 CATEGORIA \`${categoria}\` — ${periodo.rotulo}`,
    description: descricaoResumo(dados),
    fields: [
      { name: 'AÇÕES', value: listaTop(acoes, l => `${l.chave} — ${E.formatarNumero(l.total)}`), inline: false },
      { name: 'MAIS ATIVOS', value: listaTop(atores, l => `${rotuloPessoa(l)} — ${E.formatarNumero(l.total)}`), inline: false },
    ],
    footer: { text: RODAPE },
    timestamp: new Date().toISOString(),
  };
}

// Sócios (cargo SÓCIO) sem registro no jogo há N dias, cruzando o ID do apelido
async function montarEmbedInativos(guild, dias) {
  await guild.members.fetch();
  const socios = [...guild.members.cache.values()].filter(m => m.roles.cache.has(config.cargos.socio));
  const comId = socios.map(m => ({ membro: m, idFivem: E.idFivemDoNick(m.nickname ?? m.displayName) }));
  const semId = comId.filter(s => !s.idFivem);
  const ultimas = await repo.ultimaAtividadePorIds(comId.filter(s => s.idFivem).map(s => s.idFivem));
  const limite = Date.now() - dias * 24 * 60 * 60 * 1000;

  const inativos = comId
    .filter(s => s.idFivem)
    .map(s => ({ ...s, ultima: ultimas.get(s.idFivem) ?? null }))
    .filter(s => !s.ultima || new Date(s.ultima).getTime() < limite)
    .sort((a, b) => (a.ultima ? new Date(a.ultima).getTime() : 0) - (b.ultima ? new Date(b.ultima).getTime() : 0));

  const linhas = inativos.slice(0, 40).map(s => {
    const quando = s.ultima ? `<t:${Math.floor(new Date(s.ultima).getTime() / 1000)}:R>` : 'nunca';
    return `<@${s.membro.id}> · ID ${s.idFivem} · última: ${quando}`;
  });
  if (inativos.length > 40) linhas.push(`*… e mais ${inativos.length - 40}*`);

  return {
    color: COR,
    title: `💤 SÓCIOS SEM ATIVIDADE NO JOGO HÁ ${dias} DIA${dias !== 1 ? 'S' : ''}`,
    description: E.truncar(linhas.join('\n') || '*Todos os sócios com ID tiveram atividade no período.*', 4096),
    fields: [
      { name: 'SÓCIOS', value: E.formatarNumero(socios.length), inline: true },
      { name: 'INATIVOS', value: E.formatarNumero(inativos.length), inline: true },
      { name: 'SEM ID NO APELIDO', value: E.formatarNumero(semId.length), inline: true },
    ],
    footer: { text: `${RODAPE} · "nunca" = nenhum log com esse ID` },
    timestamp: new Date().toISOString(),
  };
}

// Pico + distintos + o ranking completo de tempo jogado de um período já
// resolvido (hoje por hora, semana/mês por dia). "Tudo" (sem início) usa a
// época como início efetivo. Devolve o campo de resumo separado do ranking
// (o ranking pode passar de 1024 caracteres e precisar de vários campos —
// ver camposRanking) — e o ranking cru, pro botão AGORA poder substituir por
// sessão-atual em vez de tempo-no-período.
async function blocoOcupacao(rotulo, periodo, granularidade, topTempoOverride = null) {
  const inicio = periodo.inicio ?? new Date(0);
  const [baselineBruto, eventos] = await Promise.all([
    repo.estadoDosJogadores(inicio),
    repo.eventosConexao(inicio, periodo.fim),
  ]);
  // Reconexão rápida (queda de conexão, o webhook engasgando) não é uma
  // visita nova — funde antes de qualquer outro cálculo. Sessão sem saída em
  // até LIMITE_SESSAO_MS depois disso se fecha sozinha, senão uma queda de
  // conexão sem log nenhum deixaria o jogador "online" indefinidamente.
  const eventosUnificados = P.unificarReconexoesRapidas(eventos, FOLGA_RECONEXAO_MS);
  const baseline = P.estadoSemSessoesExpiradas(baselineBruto, LIMITE_SESSAO_MS, inicio);
  const eventosAjustados = P.comFechamentosAutomaticos(baseline, eventosUnificados, LIMITE_SESSAO_MS, periodo.fim);

  const idsNoInicio = P.idsOnline(baseline);
  const hora = granularidade === 'hora';
  const baldes = E.gerarBaldes(
    inicio, periodo.fim,
    hora ? E.HORA_MS : E.DIA_MS,
    hora ? E.chaveHora : E.chaveDia,
    hora ? E.inicioDaHoraSP : E.inicioDoDiaSP
  );
  const serie = P.serieDeOcupacao(idsNoInicio, eventosAjustados, baldes);
  const pico = P.picoDoPeriodo(idsNoInicio, serie);

  const tempoPorId = P.tempoJogadoPorPeriodo(baseline, eventosAjustados, inicio, periodo.fim);
  const ranking = topTempoOverride ?? [...tempoPorId.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.ms - a.ms);
  // "Jogadores distintos" tem que bater com quem aparece na lista "MAIS
  // TEMPO JOGADO" logo abaixo (o total entre parênteses no título dela) —
  // contar direto na tabela de logs (jogadoresDistintosNoPeriodo, como era
  // antes) incluía gente com só um evento órfão no período (ex.: uma "saída"
  // sem "entrada" correspondente, log perdido), que não tem sessão pra
  // calcular e por isso não entra no ranking. Pro botão AGORA
  // (topTempoOverride = quem está online neste instante) esse número
  // continuaria sendo só "quem tá online", então usa o cálculo de sessões do
  // período inteiro (tempoPorId) mesmo nesse caso, não o override.
  const distintos = tempoPorId.size;

  const linhas = [
    `**Pico de simultâneos:** ${E.formatarNumero(pico)}`,
    `**Jogadores distintos:** ${E.formatarNumero(distintos)}`,
  ];
  if (serie.some(b => b.pico > 0)) {
    linhas.push('', `\`${E.sparkline(serie.map(b => b.pico))}\` *(variação ${hora ? 'por hora' : 'por dia'})*`);
  }
  return { resumo: { name: rotulo, value: E.truncar(linhas.join('\n'), 1024), inline: false }, ranking };
}

// "Hoje/últimos 7-30-90 dias/tudo" incluem o presente: fazem sentido junto
// de "online agora". "Ontem/semana passada/mês passado" são passado fechado:
// mostrar "online agora" ali seria mostrar um número que não tem nada a ver
// com o período pedido (era exatamente por isso que os botões pareciam "não
// filtrar" — o número não mudava porque é sempre o presente).
const PERIODOS_COM_PRESENTE = new Set(['hoje', '7d', '30d', '90d', 'tudo']);

// Maior pico de simultâneos já visto em todo o histórico de logs (não
// necessariamente o recorde real do servidor: o log perde mensagem de vez em
// quando, e perde mais ainda justo nos picos, quando muita gente entra/sai ao
// mesmo tempo e o Discord passa a limitar o webhook — por isso tende a ficar
// um pouco abaixo do número que o próprio jogo mostra).
async function picoHistoricoRegistrado() {
  const fim = new Date();
  const [baselineBruto, eventos] = await Promise.all([
    repo.estadoDosJogadores(new Date(0)),
    repo.eventosConexao(new Date(0), fim),
  ]);
  const eventosUnificados = P.unificarReconexoesRapidas(eventos, FOLGA_RECONEXAO_MS);
  const baseline = P.estadoSemSessoesExpiradas(baselineBruto, LIMITE_SESSAO_MS, new Date(0));
  const eventosAjustados = P.comFechamentosAutomaticos(baseline, eventosUnificados, LIMITE_SESSAO_MS, fim);
  const serie = P.serieDeOcupacao([], eventosAjustados, [{ chave: 'tudo', fim: fim.getTime() }]);
  return P.picoDoPeriodo([], serie);
}

// `manual` são os números batidos à mão a partir do painel/ranking do
// próprio jogo (botão EDITAR, só pra liderança) — ficam fixos ao lado dos
// automáticos, sem entrar na conta de ninguém, só pra comparação. Formato:
// `{ socios: { valor, atualizadoPor, atualizadoEm }, pico: {...} }`, cada
// chave gravada e lida por presencaInteracoes.js (CAMPOS_MANUAIS).
//
// Linhas fixas repetidas no painel E em cada consulta de período (ver
// montarDadosPresenca) — sem isso, abrir um período parecia "não bater" com
// os números fixos do painel, que ficavam só na mensagem principal.
function linhasContexto(sociosCount, manual, pico) {
  return [
    sociosCount != null ? `**SÓCIOS COM CARGO NO DISCORD:** ${E.formatarNumero(sociosCount)}` : null,
    manual?.socios?.valor != null ? `**SÓCIOS SETADOS (CONFERIDO À MÃO):** ${E.formatarNumero(manual.socios.valor)}` : null,
    `**MAIOR PICO JÁ REGISTRADO NOS LOGS:** ${E.formatarNumero(pico)}`,
    manual?.pico?.valor != null ? `**MAIOR BONDE MENSAL (RANKING DO JOGO):** ${E.formatarNumero(manual.pico.valor)}` : null,
  ].filter(l => l !== null);
}

// Painel fixo: só os valores-chave (online agora, sócios, maior pico já
// registrado). O detalhe por período (lista de quem está online, pico e
// tempo jogado de hoje/semana/mês/ontem/...) fica nos botões — cada um abre
// só pra quem clicou, com montarEmbedPresenca.
async function montarEmbedJogadoresOnline(sociosCount, manual = null, agora = new Date()) {
  const estadoAgora = P.estadoSemSessoesExpiradas(await repo.estadoDosJogadores(agora), LIMITE_SESSAO_MS, agora);
  const online = P.listaOnline(estadoAgora);
  const pico = await picoHistoricoRegistrado();

  return {
    color: COR,
    title: '🎮 JOGADORES ONLINE — GAVIÕES DA FIEL FIVEM',
    description: [
      `**ONLINE AGORA:** ${E.formatarNumero(online.length)}`,
      ...linhasContexto(sociosCount, manual, pico),
      '',
      '*Escolha um período abaixo pra ver quem está online e o pico de simultâneos.*',
    ].join('\n'),
    footer: { text: `${RODAPE} · ${AVISO_DIVERGENCIA} · canal logs-painel` },
    timestamp: new Date().toISOString(),
  };
}

// Dados crus pro /estatisticas online e os botões do painel: pico +
// distintos + a lista inteira (quem está online, ou o ranking de tempo
// jogado do período — nunca só um top 5). Quem monta o embed e pagina é
// utils/logsJogo/presencaInteracoes.js: uma lista de centenas de jogadores
// não cabe num embed só (limite de 6000 caracteres/25 campos do Discord).
//
// "Hoje"/"ontem" quebram por hora; o resto por dia. A lista "QUEM ESTÁ
// ONLINE" (quem está conectado neste exato instante) só existe no período
// "hoje" (botão AGORA) — não faz sentido misturar um retrato do presente
// dentro de um relatório de "últimos 7 dias" ou "mês passado": o número
// mudaria conforme a hora do clique, sem relação com o período pedido. Nos
// demais, "Online agora" fica só como uma linha de contexto (quando o
// período inclui o presente).
// `contexto` (sociosCount + manual) é o mesmo par que o painel fixo usa —
// vem de quem chama (presencaInteracoes.js tem acesso à guild e ao config
// manual), pra repetir os mesmos 3 números fixos aqui embaixo da linha de
// "Online agora"/período, e não só na mensagem principal do painel.
async function montarDadosPresenca(periodo, contexto = {}, agora = new Date()) {
  const comPresente = PERIODOS_COM_PRESENTE.has(periodo.chave);
  const ehAgora = periodo.chave === 'hoje';
  const granularidade = ['hoje', 'ontem'].includes(periodo.chave) ? 'hora' : 'dia';
  // O rótulo do bloco não pode dizer "POR DIA"/"POR HORA": pico e distintos
  // são do PERÍODO inteiro, não um valor por unidade de tempo — só o
  // sparkline é quebrado por hora/dia, e isso já fica na legenda dele (ver
  // blocoOcupacao).
  const rotuloBloco = 'OCUPAÇÃO NO PERÍODO';

  let online = null;
  let topTempoOverride = null;
  if (ehAgora) {
    const estadoAgora = P.estadoSemSessoesExpiradas(await repo.estadoDosJogadores(agora), LIMITE_SESSAO_MS, agora);
    online = P.listaOnline(estadoAgora);
    // "Tempo jogado" vira "sessão atual inteira" — sem cortar na virada da
    // meia-noite, senão quem entrou antes de hoje começar pareceria ter
    // jogado pouco, quando só a CONTAGEM de hoje é curta, não a sessão.
    topTempoOverride = [...online]
      .sort((a, b) => new Date(a.desde) - new Date(b.desde))
      .map(j => ({ id: j.id, nome: j.nome, ms: agora.getTime() - new Date(j.desde).getTime(), desde: j.desde }));
  }

  const [bloco, picoHistorico] = await Promise.all([
    blocoOcupacao(rotuloBloco, periodo, granularidade, topTempoOverride),
    picoHistoricoRegistrado(),
  ]);

  let linhaOnline;
  if (ehAgora) {
    linhaOnline = `**ONLINE AGORA:** ${E.formatarNumero(online.length)}`;
  } else if (comPresente) {
    const agoraOnline = P.totalOnline(P.estadoSemSessoesExpiradas(await repo.estadoDosJogadores(agora), LIMITE_SESSAO_MS, agora));
    linhaOnline = `**ONLINE AGORA:** ${E.formatarNumero(agoraOnline)}`;
  } else {
    const diaInicio = E.formatarDiaCurto(E.chaveDia(periodo.inicio));
    const diaFim = E.formatarDiaCurto(E.chaveDia(new Date(periodo.fim.getTime() - 1)));
    const faixa = diaInicio === diaFim ? diaInicio : `${diaInicio} → ${diaFim}`;
    linhaOnline = `*Período fechado: ${faixa}.*`;
  }
  // Os mesmos números fixos do painel (sócios, pico histórico, bonde
  // mensal manual), repetidos aqui pra essa consulta "bater" com o painel.
  const linhaTopo = [linhaOnline, ...linhasContexto(contexto.sociosCount, contexto.manual, picoHistorico)].join('\n');

  const tituloLista = ehAgora ? 'QUEM ESTÁ ONLINE' : `MAIS TEMPO JOGADO — ${periodo.rotulo}`;
  // Entradas em ordem de exibição, cru — quem formata a linha e monta o
  // select de filtro por ID é presencaInteracoes.js. Pro "hoje" (AGORA), a
  // lista fica alfabética (mais fácil de achar alguém agora); pros demais,
  // do maior pro menor tempo jogado — mas o `ms` de cada um é o mesmo dado
  // usado no ranking (bloco.ranking), pra "filtrar por ID" bater com o que
  // aparece na lista.
  const entradas = ehAgora
    ? [...topTempoOverride].sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR'))
    : bloco.ranking;

  return {
    titulo: `🎮 PRESENÇA DE JOGADORES — ${periodo.rotulo}`,
    linhaTopo,
    resumo: bloco.resumo,
    tituloLista,
    ehAgora,
    entradas,
  };
}

// Períodos fechados/rolantes mostrados na ficha cross-período de um jogador
// buscado pelo painel fixo (botão "BUSCAR JOGADOR"). "Agora" fica de fora
// daqui: vira `sessaoAtual` abaixo, igual ao botão AGORA — sessão inteira,
// sem cortar na virada do dia.
const PERIODOS_FICHA = ['7d', '30d', 'ontem', 'semana_passada', 'mes_passado'];

// Tempo jogado por UM ID específico em cada período de PERIODOS_FICHA, mais a
// sessão atual (se estiver online agora) — usado pela busca direta de
// jogador no painel fixo (sem passar por nenhum período antes). Reusa as
// mesmas primitivas de blocoOcupacao (reconexão rápida, fechamento
// automático de sessão), só que escopadas a um ID só e a partir de UMA busca
// no histórico inteiro de conexão, não uma consulta por período.
async function montarFichaCompletaJogador(idFivem, agora = new Date()) {
  const eventosDoId = (await repo.eventosConexao(new Date(0), agora)).filter(e => e.id === idFivem);
  const eventos = P.unificarReconexoesRapidas(eventosDoId, FOLGA_RECONEXAO_MS);

  const ultimo = eventos[eventos.length - 1] ?? null;
  const nome = ultimo?.nome ?? null;
  let sessaoAtual = null;
  if (ultimo?.acao === 'jogador_entrou' && agora.getTime() - new Date(ultimo.ocorrido_em).getTime() <= LIMITE_SESSAO_MS) {
    sessaoAtual = { desde: ultimo.ocorrido_em, ms: agora.getTime() - new Date(ultimo.ocorrido_em).getTime() };
  }

  const porPeriodo = PERIODOS_FICHA.map(chave => {
    const periodo = E.resolverPeriodo(chave, agora);
    const inicio = periodo.inicio ?? new Date(0);
    const baselineBruto = eventos.filter(e => new Date(e.ocorrido_em).getTime() < inicio.getTime()).slice(-1);
    const baseline = P.estadoSemSessoesExpiradas(baselineBruto, LIMITE_SESSAO_MS, inicio);
    const eventosNoPeriodo = eventos.filter(e => {
      const t = new Date(e.ocorrido_em).getTime();
      return t >= inicio.getTime() && t < periodo.fim.getTime();
    });
    const eventosAjustados = P.comFechamentosAutomaticos(baseline, eventosNoPeriodo, LIMITE_SESSAO_MS, periodo.fim);
    const mapa = P.tempoJogadoPorPeriodo(baseline, eventosAjustados, inicio, periodo.fim);
    return { chave, rotulo: periodo.rotulo, ms: mapa.get(idFivem)?.ms ?? 0 };
  });

  return { idFivem, nome, sessaoAtual, porPeriodo };
}

module.exports = {
  montarEmbedTorcida,
  montarEmbedMembro,
  montarEmbedCategoria,
  montarEmbedInativos,
  montarEmbedJogadoresOnline,
  montarDadosPresenca,
  montarFichaCompletaJogador,
  picoHistoricoRegistrado,
};
