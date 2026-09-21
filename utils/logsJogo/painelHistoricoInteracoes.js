const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const E = require('./estatisticas');
const F = require('./painelFormato');
const A = require('./analises');
const repo = require('./repositorio');
const relatorios = require('./relatorios');
const { selectBuscarJogador } = require('./painelComponentesFixos');
const { criarArmazemConsultas, mensagemErroConsulta } = require('./consultasEmMemoria');
const { abrirConsulta } = require('./consultas');
const { linhaAdvertenciaDiscord } = require('./advertenciaDiscord');
const { embedFichaCompleta } = require('./presencaInteracoes');
const { embedFichaPessoa: embedBau } = require('./painelBauInteracoes');
const { embedFichaJogador: embedCaixa } = require('./painelCaixaInteracoes');
const { embedFichaJogador: embedDisciplina } = require('./painelDisciplinaInteracoes');
const { embedFichaJogador: embedRestricoes } = require('./painelRestricoesInteracoes');
const { embedFichaJogador: embedTags } = require('./painelTagsInteracoes');
const { embedFichaJogador: embedFechaduras } = require('./painelFechadurasInteracoes');

// Canal 📜・historico-do-associado: não tem estado próprio (não guarda nada
// que os outros canais de log já não tenham) — é só um cruzamento por
// jogador de tudo que os OUTROS canais de inteligência já calculam. Por isso
// cada seção do resumo/detalhe chama a ficha que o módulo dono do domínio já
// expõe (embedFichaJogador de cada um) em vez de duplicar a query — ver
// docs/padroes-e-canais.md § 2. As únicas exceções são presença (a versão
// completa mora em presencaInteracoes.js, também reaproveitada) e território
// (nenhum dos painéis existentes tem uma ficha por JOGADOR — lá o "alvo" do
// evento é o território, não a pessoa — então a seção de detalhe é montada
// aqui mesmo, ver embedTerritorioDetalhe).
const MODULO = 'historico';
const ORIGEM = 'todos os canais de log do jogo';
const ACOES_TERRITORIO = ['coins_dominacao', 'coins_conquista'];
const ACOES_DISCIPLINA = [...A.ACOES_ADVERTENCIA, 'multou'];
const ACOES_FECHADURA_TUDO = [...A.ACOES_FECHADURA, 'arena_bloqueou', 'arena_desbloqueou'];
const LIMITE_CONTAGEM = 500;
const armazem = criarArmazemConsultas();

async function contarEventos(fn, idFivem, acoes) {
  const eventos = await fn(idFivem, acoes, LIMITE_CONTAGEM);
  return { total: eventos.length, ultimo: eventos[0] ?? null };
}

// ── Resumo consolidado (primeira resposta ao selecionar o jogador) ──────────

async function embedResumo(idFivem, nomeConhecido, membro) {
  const [geral, ficha, carreira, bau, deposito, saque, disciplina, restricoes, tags, territorio, fechaduras] = await Promise.all([
    repo.resumo({ idFivem }),
    relatorios.montarFichaCompletaJogador(idFivem),
    repo.historicoCargo(idFivem),
    repo.atividadeBauPorId(idFivem, 1),
    repo.resumo({ idFivem, acao: 'banco_depositou' }),
    repo.resumo({ idFivem, acao: 'banco_sacou' }),
    contarEventos(repo.eventosDoAlvo, idFivem, ACOES_DISCIPLINA),
    contarEventos(repo.eventosDoAlvo, idFivem, A.ACOES_RESTRICAO),
    contarEventos(repo.eventosDoAlvo, idFivem, [...A.ACOES_TAG, ...A.ACOES_SAIDA]),
    contarEventos(repo.eventosDoAtor, idFivem, ACOES_TERRITORIO),
    contarEventos(repo.eventosDoAtor, idFivem, ACOES_FECHADURA_TUDO),
  ]);

  const nome = nomeConhecido ?? ficha.nome ?? idFivem;
  const periodoFicha = chave => ficha.porPeriodo.find(p => p.chave === chave);

  const linhaPresenca = [
    ficha.sessaoAtual ? `online agora (${E.formatarDuracao(ficha.sessaoAtual.ms)})` : 'offline agora',
    `7d: ${E.formatarDuracao(periodoFicha('7d')?.ms ?? 0)}`,
    `30d: ${E.formatarDuracao(periodoFicha('30d')?.ms ?? 0)}`,
  ].join(' · ');

  let linhaCarreira = 'nenhuma promoção/rebaixamento registrado.';
  if (carreira.length) {
    const ultima = carreira[carreira.length - 1];
    const mudanca = E.extrairMudancaCargo(ultima.descricao);
    const atual = mudanca ? mudanca.para : (ultima.acao === 'promoveu_cargo' ? 'promovido' : 'rebaixado');
    linhaCarreira = `atual: ${atual} · ${E.formatarNumero(carreira.length)} evento(s) desde ${E.formatarDataHora(carreira[0].ocorrido_em)}`;
  }

  const linhaDeposito = deposito.total ? `depositou ${E.formatarDinheiro(deposito.valor_total)} em ${E.formatarNumero(deposito.total)}×` : 'nenhum depósito';
  const linhaSaque = saque.total ? `sacou ${E.formatarDinheiro(saque.valor_total)} em ${E.formatarNumero(saque.total)}×` : 'nenhum saque';
  const linhaBau = (bau.guardou || bau.removeu)
    ? `guardou ${E.formatarNumero(bau.guardou)} e retirou ${E.formatarNumero(bau.removeu)} item(ns) do baú (líquido)`
    : 'nenhuma movimentação no baú';

  const linhaDisciplina = disciplina.total
    ? `${E.formatarNumero(disciplina.total)} evento(s) · último: ${disciplina.ultimo.acao} em ${E.formatarDataHora(disciplina.ultimo.ocorrido_em)}`
    : 'nenhuma advertência ou multa registrada';
  const linhaRestricoes = restricoes.total
    ? `${E.formatarNumero(restricoes.total)} evento(s) · último: ${restricoes.ultimo.acao} em ${E.formatarDataHora(restricoes.ultimo.ocorrido_em)}`
    : 'nenhuma restrição registrada';
  const linhaTags = tags.total
    ? `${E.formatarNumero(tags.total)} evento(s) · último: ${tags.ultimo.acao} em ${E.formatarDataHora(tags.ultimo.ocorrido_em)}`
    : 'nenhuma tag ou saída registrada';

  const linhaTerritorio = territorio.total
    ? `${E.formatarNumero(territorio.total)} evento(s) de conquista/domínio · último em ${E.formatarDataHora(territorio.ultimo.ocorrido_em)}`
    : 'nenhuma conquista/domínio registrado';
  const linhaFechaduras = fechaduras.total
    ? `${E.formatarNumero(fechaduras.total)} movimento(s) · último em ${E.formatarDataHora(fechaduras.ultimo.ocorrido_em)}`
    : 'nenhum movimento de fechadura/arena registrado';

  return {
    color: F.COR,
    title: `📜 ${F.nomeSeguro(nome)} — HISTÓRICO DO ASSOCIADO`,
    description: [
      `**ID do jogo:** \`${idFivem}\``,
      geral.primeira_em ? `**Primeiro registro:** ${E.formatarDataHora(geral.primeira_em)}` : null,
      geral.ultima_em ? `**Última atividade (qualquer log):** ${E.formatarDataHora(geral.ultima_em)}` : null,
      `**Total de registros nos logs:** ${E.formatarNumero(geral.total)}`,
    ].filter(Boolean).join('\n'),
    fields: [
      { name: '🎮 PRESENÇA', value: linhaPresenca },
      { name: '🪜 CARREIRA', value: linhaCarreira },
      { name: '💰 DINHEIRO E BAÚ', value: [linhaDeposito, linhaSaque, linhaBau].join('\n') },
      { name: '⚖️ CONDUTA', value: [linhaAdvertenciaDiscord(membro) ?? '**Advertência (Discord):** não conferida', linhaDisciplina, linhaRestricoes, linhaTags].join('\n') },
      { name: '🗺️ ATIVIDADE NA TORCIDA', value: [linhaTerritorio, linhaFechaduras].join('\n') },
    ],
    footer: { text: `${F.rodape(ORIGEM)} · escolha um item abaixo pra ver o histórico completo` },
    timestamp: new Date().toISOString(),
  };
}

function selectDetalhe(consultaId) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${MODULO}:verdetalhe:${consultaId}`)
    .setPlaceholder('VER HISTÓRICO COMPLETO DE...')
    .addOptions([
      { label: '🎮 Presença (por período)', value: 'presenca' },
      { label: '🪜 Carreira (promoções/rebaixamentos)', value: 'carreira' },
      { label: '📦 Baú', value: 'bau' },
      { label: '🏦 Caixa (banco/honra)', value: 'caixa' },
      { label: '⚖️ Disciplina (advertências/multas)', value: 'disciplina' },
      { label: '⛔ Restrições', value: 'restricoes' },
      { label: '🏷️ Tags e saídas', value: 'tags' },
      { label: '🗺️ Território', value: 'territorio' },
      { label: '🔐 Fechaduras e arena', value: 'fechaduras' },
      { label: '📜 Tudo (log bruto, paginado)', value: 'tudo' },
    ]);
  return new ActionRowBuilder().addComponents(select);
}

// ── Detalhe por domínio (segunda resposta, depois de escolher no select) ────

function linhaEventoTerritorio(e) {
  const verbo = e.acao === 'coins_conquista' ? 'conquistou' : 'dominou';
  return `• ${verbo} ${F.nomeSeguro(e.alvo_nome ?? '?')} — ${E.formatarDataHora(e.ocorrido_em)}`;
}

async function embedTerritorioDetalhe(idFivem, nomeConhecido) {
  const eventos = await repo.eventosDoAtor(idFivem, ACOES_TERRITORIO, LIMITE_CONTAGEM);
  const conquistas = eventos.filter(e => e.acao === 'coins_conquista').length;
  return {
    color: F.COR,
    title: `🗺️ ${F.nomeSeguro(nomeConhecido ?? idFivem)} — TERRITÓRIO`,
    description: [`**ID:** \`${idFivem}\``, `**Conquistas:** ${E.formatarNumero(conquistas)}`, `**Total de eventos (conquista + domínio):** ${E.formatarNumero(eventos.length)}`].join('\n'),
    fields: F.campoLista('ÚLTIMOS EVENTOS', eventos.slice(0, 25).map(linhaEventoTerritorio), 'Nenhum evento registrado.'),
    footer: { text: F.rodape('canal logs-banco') },
  };
}

async function montarEmbedDetalhe(escolha, idFivem, nome, client) {
  switch (escolha) {
    case 'presenca': return embedFichaCompleta({ displayName: nome }, await relatorios.montarFichaCompletaJogador(idFivem));
    case 'carreira': return relatorios.montarEmbedCarreira(idFivem, F.nomeSeguro(nome ?? idFivem));
    case 'bau': return embedBau(idFivem, nome);
    case 'caixa': return embedCaixa(idFivem, nome);
    case 'disciplina': return embedDisciplina(idFivem, nome);
    case 'restricoes': return embedRestricoes(client, idFivem, nome);
    case 'tags': return embedTags(idFivem, nome);
    case 'territorio': return embedTerritorioDetalhe(idFivem, nome);
    case 'fechaduras': return embedFechaduras(idFivem, nome);
    default: return null;
  }
}

function linhaComponentesHistorico() {
  return [selectBuscarJogador(MODULO)];
}

registrarModulo(MODULO, async interaction => {
  const [, acao, a] = interaction.customId.split(':');

  if (interaction.isUserSelectMenu() && acao === 'buscarjogador') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const membro = interaction.members.first();
    const idFivem = E.idFivemDoNick(membro?.nickname ?? membro?.displayName);
    if (!idFivem) {
      return interaction.reply({ content: `❌ ${membro ?? 'ESSE MEMBRO'} NÃO TEM ID DO JOGO NO APELIDO (PADRÃO "... - 1234").`, flags: 64, allowedMentions: { parse: [] } });
    }
    await interaction.deferReply({ flags: 64 });
    const consultaId = armazem.salvar(interaction.user.id, { idFivem, nome: membro.displayName });
    const embed = await embedResumo(idFivem, membro.displayName, membro);
    await interaction.editReply({ embeds: [embed], components: [selectDetalhe(consultaId)] });
    return;
  }

  if (interaction.isStringSelectMenu() && acao === 'verdetalhe') {
    const { erro, consulta } = armazem.obter(a, interaction.user.id);
    if (erro) return interaction.reply({ content: mensagemErroConsulta(erro), flags: 64 });
    const { idFivem, nome } = consulta;
    const escolha = interaction.values[0];

    if (escolha === 'tudo') {
      await interaction.deferReply({ flags: 64 });
      await abrirConsulta(interaction, { idFivem }, `histórico completo · ${F.nomeSeguro(nome ?? idFivem)} (${idFivem})`);
      return;
    }

    await interaction.deferReply({ flags: 64 });
    const embed = await montarEmbedDetalhe(escolha, idFivem, nome, interaction.client);
    await interaction.editReply({ embeds: [embed] });
    return;
  }
});

module.exports = { linhaComponentesHistorico };
