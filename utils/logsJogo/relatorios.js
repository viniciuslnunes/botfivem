const config = require('../../config/index.js');
const repo = require('./repositorio');
const E = require('./estatisticas');
const P = require('./presenca');

// Embeds de estatística, compartilhados por /estatisticas e pelo painel fixo.

const COR = 0x000000;
const RODAPE = 'Com base nos logs do jogo recebidos pelo webhook';
const LIMITE_SESSAO_MS = config.logsJogo.presencaSessaoMaxHoras * 60 * 60 * 1000;

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

// Um bloco "pico + distintos" para um período já resolvido (hoje por hora,
// semana/mês por dia). "Tudo" (sem início) usa a época como início efetivo.
//
// `topTempoOverride`, quando passado, substitui o ranking "tempo jogado
// dentro do período" (que corta na virada do dia/semana/mês) por outro já
// pronto — usado pelo botão AGORA, onde faz mais sentido mostrar a sessão
// atual inteira de quem está online do que só a fatia de hoje.
async function blocoOcupacao(rotulo, periodo, granularidade, topTempoOverride = null) {
  const inicio = periodo.inicio ?? new Date(0);
  const [baselineBruto, eventos, distintos] = await Promise.all([
    repo.estadoDosJogadores(inicio),
    repo.eventosConexao(inicio, periodo.fim),
    repo.jogadoresDistintosNoPeriodo(inicio, periodo.fim),
  ]);
  // Sessão sem saída em até LIMITE_SESSAO_MS se fecha sozinha, senão uma
  // queda de conexão sem log deixaria o jogador "online" indefinidamente e
  // inflaria pico e tempo jogado.
  const baseline = P.estadoSemSessoesExpiradas(baselineBruto, LIMITE_SESSAO_MS, inicio);
  const eventosAjustados = P.comFechamentosAutomaticos(baseline, eventos, LIMITE_SESSAO_MS, periodo.fim);

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

  const rotuloTempo = topTempoOverride ? 'Sessão mais longa (agora):' : 'Mais tempo jogado:';
  const topTempo = topTempoOverride ?? [...P.tempoJogadoPorPeriodo(baseline, eventosAjustados, inicio, periodo.fim).entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5);

  const linhas = [
    `**Pico de simultâneos:** ${E.formatarNumero(pico)}`,
    `**Jogadores distintos:** ${E.formatarNumero(distintos)}`,
  ];
  if (serie.some(b => b.pico > 0)) linhas.push('', `\`${E.sparkline(serie.map(b => b.pico))}\``);
  if (topTempo.length) {
    linhas.push('', `**${rotuloTempo}**`,
      ...topTempo.map((t, i) => `${i + 1}. ${t.nome ?? '?'} \`${t.id}\` — ${E.formatarDuracao(t.ms)}`));
  }
  return { name: rotulo, value: E.truncar(linhas.join('\n'), 1024), inline: false };
}

// Uma linha por jogador, em ordem alfabética, com o tempo de sessão que o
// Discord mantém atualizado sozinho (<t:...:R>)
function linhaOnline(j) {
  const desde = Math.floor(new Date(j.desde).getTime() / 1000);
  return `**${j.nome ?? '?'}**${j.id ? ` \`${j.id}\`` : ''} · desde <t:${desde}:R>`;
}

// Cabe ~20 linhas por campo de 1024 caracteres; o resto some num "e mais N"
// e continua contado no "Online agora" lá em cima.
const MAX_POR_CAMPO = 20;

// Campo(s) "QUEM ESTÁ ONLINE": uma coluna vertical, um jogador por linha.
// Mais de ~20 exige um segundo campo (limite de 1024 caracteres por campo).
function camposOnline(online) {
  if (!online.length) {
    return [{ name: 'QUEM ESTÁ ONLINE', value: '*Ninguém online agora.*', inline: false }];
  }
  const ordenados = [...online].sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR'));
  const linhas = ordenados.map(linhaOnline);

  const campos = [];
  for (let i = 0; i < linhas.length && i < MAX_POR_CAMPO * 3; i += MAX_POR_CAMPO) {
    campos.push({
      name: i === 0 ? 'QUEM ESTÁ ONLINE' : '​',
      value: E.truncar(linhas.slice(i, i + MAX_POR_CAMPO).join('\n'), 1024),
      inline: false,
    });
  }
  const resto = linhas.length - MAX_POR_CAMPO * 3;
  if (resto > 0) campos.push({ name: '​', value: `*… e mais ${E.formatarNumero(resto)}.*`, inline: false });
  return campos;
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
  const baseline = P.estadoSemSessoesExpiradas(baselineBruto, LIMITE_SESSAO_MS, new Date(0));
  const eventosAjustados = P.comFechamentosAutomaticos(baseline, eventos, LIMITE_SESSAO_MS, fim);
  const serie = P.serieDeOcupacao([], eventosAjustados, [{ chave: 'tudo', fim: fim.getTime() }]);
  return P.picoDoPeriodo([], serie);
}

// Painel fixo: só os valores-chave (online agora, sócios, maior pico já
// registrado). O detalhe por período (lista de quem está online, pico e
// tempo jogado de hoje/semana/mês/ontem/...) fica nos botões — cada um abre
// só pra quem clicou, com montarEmbedPresenca.
async function montarEmbedJogadoresOnline(sociosCount, agora = new Date()) {
  const estadoAgora = P.estadoSemSessoesExpiradas(await repo.estadoDosJogadores(agora), LIMITE_SESSAO_MS, agora);
  const online = P.listaOnline(estadoAgora);
  const pico = await picoHistoricoRegistrado();

  return {
    color: COR,
    title: '🎮 JOGADORES ONLINE — GAVIÕES DA FIEL FIVEM',
    description: [
      `**Online agora:** ${E.formatarNumero(online.length)}`,
      sociosCount != null ? `**Sócios:** ${E.formatarNumero(sociosCount)}` : null,
      `**Maior pico já registrado nos logs:** ${E.formatarNumero(pico)}`,
      '',
      '*Escolha um período abaixo pra ver quem está online e o pico de simultâneos.*',
    ].filter(l => l !== null).join('\n'),
    footer: { text: `${RODAPE} · canal logs-painel` },
    timestamp: new Date().toISOString(),
  };
}

// Consulta sob demanda (/estatisticas online e os botões do painel): pico +
// distintos + tempo jogado do período escolhido. "Hoje"/"ontem" quebram por
// hora; o resto por dia. "Online agora" e a lista de quem está online só
// aparecem em período que inclui o presente — não fazem sentido num período
// passado fechado (ontem, semana passada, mês passado).
async function montarEmbedPresenca(periodo, agora = new Date()) {
  const comPresente = PERIODOS_COM_PRESENTE.has(periodo.chave);
  const granularidade = ['hoje', 'ontem'].includes(periodo.chave) ? 'hora' : 'dia';
  const rotuloBloco = granularidade === 'hora' ? 'POR HORA' : 'POR DIA';

  if (!comPresente) {
    const bloco = await blocoOcupacao(rotuloBloco, periodo, granularidade);
    const diaInicio = E.formatarDiaCurto(E.chaveDia(periodo.inicio));
    const diaFim = E.formatarDiaCurto(E.chaveDia(new Date(periodo.fim.getTime() - 1)));
    const faixa = diaInicio === diaFim ? diaInicio : `${diaInicio} → ${diaFim}`;
    return {
      color: COR,
      title: `🎮 PRESENÇA DE JOGADORES — ${periodo.rotulo}`,
      description: `*Período fechado: ${faixa}.*`,
      fields: [bloco],
      footer: { text: `${RODAPE} · canal logs-painel` },
      timestamp: new Date().toISOString(),
    };
  }

  const estadoAgora = P.estadoSemSessoesExpiradas(await repo.estadoDosJogadores(agora), LIMITE_SESSAO_MS, agora);
  const online = P.listaOnline(estadoAgora);

  // Botão AGORA (período "hoje"): "tempo jogado" vira "sessão mais longa" —
  // a sessão inteira de quem está online, sem cortar na virada da meia-noite.
  // Senão, alguém que entrou antes de hoje começar pareceria ter jogado
  // pouco, quando na verdade só a CONTAGEM de hoje é curta, não a sessão.
  const topTempoOverride = periodo.chave === 'hoje'
    ? [...online].sort((a, b) => new Date(a.desde) - new Date(b.desde))
      .slice(0, 5)
      .map(j => ({ id: j.id, nome: j.nome, ms: agora.getTime() - new Date(j.desde).getTime() }))
    : null;
  const bloco = await blocoOcupacao(rotuloBloco, periodo, granularidade, topTempoOverride);

  return {
    color: COR,
    title: `🎮 PRESENÇA DE JOGADORES — ${periodo.rotulo}`,
    description: `**Online agora:** ${E.formatarNumero(online.length)}`,
    fields: [...camposOnline(online), bloco],
    footer: { text: `${RODAPE} · canal logs-painel` },
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  montarEmbedTorcida,
  montarEmbedMembro,
  montarEmbedCategoria,
  montarEmbedInativos,
  montarEmbedJogadoresOnline,
  montarEmbedPresenca,
};
