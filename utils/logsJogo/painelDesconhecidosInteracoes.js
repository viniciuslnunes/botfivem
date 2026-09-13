const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const E = require('./estatisticas');
const F = require('./painelFormato');
const A = require('./analises');
const repo = require('./repositorio');
const { criarArmazemConsultas, mensagemErroConsulta } = require('./consultasEmMemoria');
const { selectPeriodo, linhaBotao, linhaPaginacao } = require('./painelComponentesFixos');

// Canal 🧩・logs-nao-reconhecidos: mesmo padrão interativo do 📦・estoque-bau,
// sem "buscar jogador" nem ranking — aqui o protagonista é o FORMATO do log,
// não uma pessoa. Só período (recorte de tempo) e "todo o histórico"
// (paginado) fazem sentido.
const MODULO = 'desconhecidos';
const AMOSTRA_MAX = 5000;

const armazem = criarArmazemConsultas();

function linhaFamilia(f, i) {
  const origem = F.nomeCanal(f.canalId);
  return `**${i + 1}. ${E.formatarNumero(f.total)}×** \`${origem}\``
    + (f.titulo ? ` · título \`${E.truncar(F.nomeSeguro(f.titulo), 40)}\`` : '')
    + `\n   ${E.truncar(F.nomeSeguro(f.exemplo), 180)}`
    + `\n   *${E.formatarDataHora(f.primeira)} → ${E.formatarDataHora(f.ultima)}*`;
}

function renderizarFamilias(consultaId, consulta) {
  const { itens, atual, totalPaginas } = armazem.pagina(consulta.familias, consulta.pagina ?? 0);
  const embed = {
    color: F.COR,
    title: `🧩 NÃO RECONHECIDOS — ${consulta.rotulo}`,
    description: [
      consulta.familias.length
        ? `**${E.formatarNumero(consulta.totalRegistros)}** registros em **${consulta.familias.length}** ${consulta.familias.length === 1 ? 'família' : 'famílias'} de formato`
        : 'Todo log que chegou foi reconhecido pelo parser. ✅',
      '',
      itens.map(linhaFamilia).join('\n') || '*Nada nesta página.*',
    ].join('\n'),
    footer: { text: `${F.rodape('todos os canais de log')} · Página ${atual + 1}/${totalPaginas}` },
  };
  return { embeds: [embed], components: [linhaPaginacao(MODULO, consultaId, atual, totalPaginas, { comBusca: false })], allowedMentions: { parse: [] } };
}

async function abrirFamilias(interaction, periodo) {
  const registros = await repo.desconhecidos(periodo, AMOSTRA_MAX);
  const familias = A.agruparDesconhecidos(registros);
  const dados = { familias, totalRegistros: registros.length, rotulo: periodo.rotulo, pagina: 0 };
  const consultaId = armazem.salvar(interaction.user.id, dados);
  await interaction.editReply(renderizarFamilias(consultaId, dados));
}

function linhaComponentesDesconhecidos() {
  return [
    selectPeriodo(MODULO, { placeholder: 'VER O QUE NÃO FOI RECONHECIDO NUM PERÍODO' }),
    linhaBotao(MODULO, 'tudo', 'TODO O HISTÓRICO', { emoji: '🧩' }),
  ];
}

registrarModulo(MODULO, async interaction => {
  const [, acao, a, b] = interaction.customId.split(':');

  if (interaction.isStringSelectMenu() && acao === 'selperiodo') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    await abrirFamilias(interaction, E.resolverPeriodo(interaction.values[0]));
    return;
  }

  if (interaction.isButton() && acao === 'tudo') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    await abrirFamilias(interaction, E.resolverPeriodo('tudo'));
    return;
  }

  if (interaction.isButton() && acao === 'pag') {
    const { erro } = armazem.obter(a, interaction.user.id);
    if (erro) return interaction.update({ content: mensagemErroConsulta(erro), embeds: [], components: [] });
    const atualizada = armazem.atualizar(a, { pagina: Number(b) || 0 });
    await interaction.update(renderizarFamilias(a, atualizada));
    return;
  }
});

module.exports = { linhaComponentesDesconhecidos };
