const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { registrarModulo } = require('../modulos');
const E = require('./estatisticas');
const F = require('./painelFormato');
const A = require('./analises');
const repo = require('./repositorio');
const { criarArmazemConsultas, mensagemErroConsulta } = require('./consultasEmMemoria');
const { selectPeriodo, selectBuscarJogador, linhaPaginacao } = require('./painelComponentesFixos');

// Canal 🏷️・tags-do-jogo: mesmo padrão interativo do 📦・estoque-bau. O select
// natural aqui é a TAG (RSJ, Arsenal, Rádio…), não período — quem tem cada tag
// é estado atual; o select de período fica pro fluxo (quem ganhou/perdeu tag
// numa janela). Sem busca por texto: escolher a tag já filtra o bastante (no
// máximo ~70 membros por tag).
const MODULO = 'tags';
const HISTORICO_MAX = 6000;

const armazem = criarArmazemConsultas();

async function tagsAtuais() {
  const eventos = await repo.listarPorAcoes([...A.ACOES_TAG, ...A.ACOES_SAIDA], E.resolverPeriodo('tudo'), HISTORICO_MAX);
  return A.tagsAtivas(eventos);
}

function linhaMembro(m, i) {
  return `${i + 1}. ${F.pessoa(m)}`;
}

function renderizarMembros(consultaId, consulta) {
  const { itens, atual, totalPaginas } = armazem.pagina(consulta.membros, consulta.pagina ?? 0);
  const embed = {
    color: F.COR,
    title: `🏷️ ${F.nomeSeguro(consulta.tag).toUpperCase()} (${consulta.membros.length})`,
    fields: F.campoLista('MEMBROS', itens.map(linhaMembro), 'Ninguém com esta tag.'),
    footer: { text: `${F.rodape('canal logs-registros')} · Página ${atual + 1}/${totalPaginas}` },
  };
  return { embeds: [embed], components: [linhaPaginacao(MODULO, consultaId, atual, totalPaginas, { comBusca: false })], allowedMentions: { parse: [] } };
}

async function abrirTag(interaction, tag) {
  const tags = await tagsAtuais();
  const escolhida = tags.find(t => t.tag === tag);
  const membros = escolhida?.membros ?? [];
  const consultaId = armazem.salvar(interaction.user.id, { tag, membros, pagina: 0 });
  await interaction.editReply(renderizarMembros(consultaId, { tag, membros, pagina: 0 }));
}

// ── Fluxo do período ──────────────────────────────────────────────────────────

async function embedFluxo(periodo) {
  const eventos = await repo.listarPorAcoes(A.ACOES_TAG, periodo, 40);
  const linhas = eventos.map(e => `${e.acao === 'tag_adicionou' ? '➕' : '➖'} ${F.pessoa({ nome: e.alvo_nome, id: e.alvo_id_fivem })}`
    + ` · **${F.nomeSeguro(E.extrairEntreParenteses(e.descricao) ?? '?')}** — por ${F.nomeSeguro(e.ator_nome)}, ${E.formatarDataHora(e.ocorrido_em)}`);
  return {
    color: F.COR,
    title: `🏷️ MUDANÇAS DE TAG — ${periodo.rotulo}`,
    description: 'Movimento do período (o quadro de quem tem cada tag hoje fica no select TAG).',
    fields: F.campoLista('EVENTOS', linhas, 'Nenhuma mudança no período.'),
    footer: { text: F.rodape('canal logs-registros') },
  };
}

// ── Ficha de jogador ─────────────────────────────────────────────────────────

async function embedFichaJogador(idFivem, nomeConhecido) {
  const eventos = await repo.eventosDoAlvo(idFivem, [...A.ACOES_TAG, ...A.ACOES_SAIDA], 500);
  const tags = A.tagsAtivas(eventos);
  return {
    color: F.COR,
    title: `🏷️ ${F.nomeSeguro(nomeConhecido ?? idFivem)} — TAGS`,
    description: [
      `**ID:** \`${idFivem}\``,
      '',
      tags.length ? `**Tags atuais:** ${tags.map(t => F.nomeSeguro(t.tag)).join(', ')}` : '*Nenhuma tag ativa.*',
    ].join('\n'),
    footer: { text: F.rodape('canal logs-registros') },
  };
}

// `tags` (já calculado no ciclo do painel fixo) vira as opções do select — até
// 25 (limite do Discord); tags além disso não caberiam de qualquer jeito.
function selectTag(tags) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(`${MODULO}:seltag`).setPlaceholder('ESCOLHA UMA TAG')
      .addOptions(tags.slice(0, 25).map(t => ({ label: `${t.tag} (${t.membros.length})`.slice(0, 100), value: t.tag })))
  );
}

function linhaComponentesTags(tags) {
  const linhas = [selectBuscarJogador(MODULO), selectPeriodo(MODULO, { placeholder: 'VER MUDANÇAS DE UM PERÍODO' })];
  if (tags.length) linhas.unshift(selectTag(tags));
  return linhas;
}

registrarModulo(MODULO, async interaction => {
  const [, acao, a, b] = interaction.customId.split(':');

  if (interaction.isStringSelectMenu() && acao === 'seltag') {
    await interaction.deferReply({ flags: 64 });
    await abrirTag(interaction, interaction.values[0]);
    return;
  }

  if (interaction.isButton() && acao === 'pag') {
    const { erro } = armazem.obter(a, interaction.user.id);
    if (erro) return interaction.update({ content: mensagemErroConsulta(erro), embeds: [], components: [] });
    const atualizada = armazem.atualizar(a, { pagina: Number(b) || 0 });
    await interaction.update(renderizarMembros(a, atualizada));
    return;
  }

  if (interaction.isUserSelectMenu() && acao === 'buscarjogador') {
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
    await interaction.deferReply({ flags: 64 });
    await interaction.editReply({ embeds: [await embedFluxo(E.resolverPeriodo(interaction.values[0]))] });
    return;
  }
});

module.exports = { linhaComponentesTags, tagsAtuais, embedFichaJogador };
