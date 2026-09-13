const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const E = require('./estatisticas');
const F = require('./painelFormato');
const repo = require('./repositorio');
const { criarArmazemConsultas, mensagemErroConsulta } = require('./consultasEmMemoria');
const { selectPeriodo, selectBuscarJogador, linhaBotao, linhaPaginacao } = require('./painelComponentesFixos');

// Canal ⚙️・auditoria-config: mesmo padrão interativo do 📦・estoque-bau. Volume
// baixo de propósito (é o canal de maior risco, não de maior movimento), mas
// segue a mesma estrutura pra não virar exceção.
const MODULO = 'auditoria';
const ACOES = ['config_alterou', 'tag_alterou', 'cargo_editado'];
const HISTORICO_MAX = 500;

const ROTULOS = { config_alterou: '⚙️ CONFIGURAÇÃO', tag_alterou: '🏷️ DEFINIÇÃO DE TAG', cargo_editado: '👑 CARGO DO JOGO' };

function detalhe(e) {
  if (e.acao === 'tag_alterou') {
    const mudanca = E.extrairMudancaCargo(e.descricao);
    return mudanca ? `${F.nomeSeguro(mudanca.de)} → ${F.nomeSeguro(mudanca.para)}` : 'tag redefinida';
  }
  return e.alvo_nome ? F.nomeSeguro(e.alvo_nome) : '—';
}

function linhaEvento(e) {
  return `${ROTULOS[e.acao] ?? e.acao} **${detalhe(e)}** — ${F.pessoa({ nome: e.ator_nome, id: e.ator_id_fivem })}, ${E.formatarDataHora(e.ocorrido_em)}`;
}

const armazem = criarArmazemConsultas();

function renderizarHistorico(consultaId, consulta) {
  const { itens, atual, totalPaginas } = armazem.pagina(consulta.eventos, consulta.pagina ?? 0);
  const embed = {
    color: F.COR,
    title: '⚙️ HISTÓRICO DE CONFIGURAÇÃO',
    fields: F.campoLista('ALTERAÇÕES', itens.map(linhaEvento), 'Nenhuma alteração registrada.'),
    footer: { text: `${F.rodape('canais logs-registros e logs-liderança')} · Página ${atual + 1}/${totalPaginas}` },
  };
  return { embeds: [embed], components: [linhaPaginacao(MODULO, consultaId, atual, totalPaginas, { comBusca: false })], allowedMentions: { parse: [] } };
}

async function abrirHistorico(interaction) {
  const eventos = await repo.listarPorAcoes(ACOES, E.resolverPeriodo('tudo'), HISTORICO_MAX).then(l => F.comNomes(l, { id: 'ator_id_fivem', nome: 'ator_nome' }));
  const consultaId = armazem.salvar(interaction.user.id, { eventos, pagina: 0 });
  await interaction.editReply(renderizarHistorico(consultaId, { eventos, pagina: 0 }));
}

async function embedFluxo(periodo) {
  const eventos = await repo.listarPorAcoes(ACOES, periodo, 40).then(l => F.comNomes(l, { id: 'ator_id_fivem', nome: 'ator_nome' }));
  return {
    color: F.COR,
    title: `⚙️ CONFIGURAÇÃO — ${periodo.rotulo}`,
    fields: F.campoLista('ALTERAÇÕES', eventos.map(linhaEvento), 'Nenhuma alteração no período.'),
    footer: { text: F.rodape('canais logs-registros e logs-liderança') },
  };
}

async function embedFichaJogador(idFivem, nomeConhecido) {
  const eventos = await repo.eventosDoAtor(idFivem, ACOES, 10);
  return {
    color: F.COR,
    title: `⚙️ ${F.nomeSeguro(nomeConhecido ?? idFivem)} — ALTERAÇÕES`,
    description: [`**ID:** \`${idFivem}\``, `**Total de alterações:** ${E.formatarNumero(eventos.length)}`].join('\n'),
    fields: F.campoLista('ALTERAÇÕES', eventos.map(linhaEvento), 'Nenhuma alteração registrada.'),
    footer: { text: F.rodape('canais logs-registros e logs-liderança') },
  };
}

function linhaComponentesAuditoria() {
  return [
    linhaBotao(MODULO, 'historico', 'HISTÓRICO COMPLETO', { emoji: '⚙️' }),
    selectBuscarJogador(MODULO),
    selectPeriodo(MODULO, { placeholder: 'VER ALTERAÇÕES DE UM PERÍODO' }),
  ];
}

registrarModulo(MODULO, async interaction => {
  const [, acao, a, b] = interaction.customId.split(':');

  if (interaction.isButton() && acao === 'historico') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    await abrirHistorico(interaction);
    return;
  }

  if (interaction.isButton() && acao === 'pag') {
    const { erro } = armazem.obter(a, interaction.user.id);
    if (erro) return interaction.update({ content: mensagemErroConsulta(erro), embeds: [], components: [] });
    const atualizada = armazem.atualizar(a, { pagina: Number(b) || 0 });
    await interaction.update(renderizarHistorico(a, atualizada));
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

  if (interaction.isStringSelectMenu() && acao === 'selperiodo') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    await interaction.editReply({ embeds: [await embedFluxo(E.resolverPeriodo(interaction.values[0]))] });
    return;
  }
});

module.exports = { linhaComponentesAuditoria, ACOES, linhaEvento };
