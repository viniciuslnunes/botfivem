const config = require('../../config/index.js');
const repo = require('./repositorio');
const E = require('./estatisticas');
const P = require('./presenca');

// Embeds de estatística, compartilhados por /estatisticas e pelo painel fixo.

const COR = 0x000000;
const RODAPE = 'Com base nos logs do jogo recebidos pelo webhook';

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
async function blocoOcupacao(rotulo, periodo, granularidade) {
  const inicio = periodo.inicio ?? new Date(0);
  const [baselineEstado, eventos, distintos] = await Promise.all([
    repo.estadoDosJogadores(inicio),
    repo.eventosConexao(inicio, periodo.fim),
    repo.jogadoresDistintosNoPeriodo(inicio, periodo.fim),
  ]);
  const idsNoInicio = P.idsOnline(baselineEstado);
  const hora = granularidade === 'hora';
  const baldes = E.gerarBaldes(
    inicio, periodo.fim,
    hora ? E.HORA_MS : E.DIA_MS,
    hora ? E.chaveHora : E.chaveDia,
    hora ? E.inicioDaHoraSP : E.inicioDoDiaSP
  );
  const serie = P.serieDeOcupacao(idsNoInicio, eventos, baldes);
  const pico = P.picoDoPeriodo(idsNoInicio, serie);

  const linhas = [
    `**Pico de simultâneos:** ${E.formatarNumero(pico)}`,
    `**Jogadores distintos:** ${E.formatarNumero(distintos)}`,
  ];
  if (serie.some(b => b.pico > 0)) linhas.push('', `\`${E.sparkline(serie.map(b => b.pico))}\``);
  return { name: rotulo, value: linhas.join('\n'), inline: false };
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

// Painel de presença: quem está online agora + pico de simultâneos por
// hora (hoje), por dia (semana e mês)
async function montarEmbedJogadoresOnline(agora = new Date()) {
  const estadoAgora = await repo.estadoDosJogadores(agora);
  const online = P.listaOnline(estadoAgora);

  const [hoje, semana, mes] = await Promise.all([
    blocoOcupacao('HOJE (pico por hora)', E.resolverPeriodo('hoje', agora), 'hora'),
    blocoOcupacao('ESTA SEMANA (pico por dia)', E.resolverPeriodo('7d', agora), 'dia'),
    blocoOcupacao('ESTE MÊS (pico por dia)', E.resolverPeriodo('30d', agora), 'dia'),
  ]);

  return {
    color: COR,
    title: '🎮 JOGADORES ONLINE — GAVIÕES DA FIEL FIVEM',
    description: `**Online agora:** ${E.formatarNumero(online.length)}`,
    fields: [...camposOnline(online), hoje, semana, mes],
    footer: { text: `${RODAPE} · canal logs-painel` },
    timestamp: new Date().toISOString(),
  };
}

// Consulta sob demanda (/estatisticas online periodo:X): mesma "online agora"
// + um único bloco de pico/distintos para o período escolhido. "Hoje" quebra
// por hora; qualquer período maior quebra por dia.
async function montarEmbedPresenca(periodo, agora = new Date()) {
  const estadoAgora = await repo.estadoDosJogadores(agora);
  const online = P.listaOnline(estadoAgora);

  const granularidade = ['hoje', 'ontem'].includes(periodo.chave) ? 'hora' : 'dia';
  const rotuloBloco = granularidade === 'hora' ? 'POR HORA' : 'POR DIA';
  const bloco = await blocoOcupacao(rotuloBloco, periodo, granularidade);

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
