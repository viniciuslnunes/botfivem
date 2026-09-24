const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, UserSelectMenuBuilder, escapeMarkdown,
} = require('discord.js');
const config = require('../../config/index.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const { garantirMembrosCarregados } = require('../membrosGuild');
const { buscarDepartamento } = require('../departamentos/repositorio');
const db = require('../db');
const E = require('./estatisticas');
const F = require('./painelFormato');
const P = require('./presenca');
const repo = require('./repositorio');
const tema = require('../../tema');
const { rotuloItem, lerLimitesFarm, limitesEfetivosFarm, CAMPOS_LIMITE, CONFIG_KEY_LIMITES } = require('./farmLimites');

// Canal 🌾・painel-farm: cruza quem tem cargo do departamento Farm (membro ou
// gestor) com o que de fato guardou nos baús habilitados
// (config.logsJogo.farm.baus) dos itens de farm (config.logsJogo.farm.itens)
// — pra liderança/gestor de área enxergar quem tá de fato trabalhando, não só
// quem tem o cargo. Mesmo padrão de painelRecrutadoresInteracoes.js (ver
// docs/padroes-e-canais.md § 1.1/1.4).
const ITENS_FARM = config.logsJogo.farm.itens.map(i => i.toLowerCase());
const BAUS_FARM = config.logsJogo.farm.baus;
const LIMITE_SESSAO_MS = config.logsJogo.presencaSessaoMaxHoras * 60 * 60 * 1000;
const PERIODO_PADRAO = '30d';

const PERIODOS_FICHA_FARM = ['7d', '30d', 'ontem', 'semana_passada', 'mes_passado'];


// ── Limite diário de retirada de droga (editável, ver docs/padroes-e-canais.md § 1.2) ──
//
// Mesmo padrão de 3 passos (botão EDITAR LIMITES → select da droga → modal
// de um campo só) que painelCaixaInteracoes.js já usa pro saldo manual —
// só que aqui são vários campos (um por droga) em vez de um só, e o
// "automático" não é calculado dos logs: é o valor de partida em
// config.logsJogo.farm.limitePadraoDroga, que a liderança sobrepõe sem
// precisar de deploy quando o dia de pista pedir mais (pedido do usuário,
// 2026-09-21).


// jsonb_set atômico (mesmo motivo de gravarCampoManualCaixa): nunca lê o
// objeto inteiro pra somar/gravar em JS — evita pisar num campo que outro
// clique tenha editado no meio-tempo.
async function gravarLimiteFarm(item, valorObj) {
  if (valorObj == null) {
    await db.query(
      `INSERT INTO bot_config (key, value) VALUES ($1, '{}')
       ON CONFLICT (key) DO UPDATE SET value = (COALESCE(bot_config.value::jsonb, '{}'::jsonb) - $2)::text`,
      [CONFIG_KEY_LIMITES, item]
    );
    return;
  }
  await db.query(
    `INSERT INTO bot_config (key, value)
     VALUES ($1, jsonb_set('{}'::jsonb, ARRAY[$2], $3::jsonb)::text)
     ON CONFLICT (key) DO UPDATE SET value = jsonb_set(
       COALESCE(bot_config.value::jsonb, '{}'::jsonb), ARRAY[$2], $3::jsonb
     )::text`,
    [CONFIG_KEY_LIMITES, item, JSON.stringify(valorObj)]
  );
}


function linhaBotoesFarm() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('farm:editarlimite').setLabel('EDITAR LIMITES').setEmoji('✏️').setStyle(ButtonStyle.Secondary)
  );
}

function selectCampoLimite() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('farm:editarlimitecampo')
    .setPlaceholder('SELECIONE A DROGA PARA EDITAR O LIMITE')
    .addOptions(CAMPOS_LIMITE.map(c => ({ label: c.rotuloSelect, value: c.chave, description: `Padrão: ${c.padrao} unid./dia` })));
  return new ActionRowBuilder().addComponents(select);
}

function modalCampoLimite(campo, valorAtual) {
  return new ModalBuilder()
    .setCustomId(`farm:editarlimitemodal:${campo.chave}`)
    .setTitle('LIMITE DIÁRIO DE FARM')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('valor').setLabel(campo.rotuloCampo)
      .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(6)
      .setPlaceholder(`Deixe em branco pro padrão (${campo.padrao}/dia)`)
      .setValue(valorAtual != null ? String(valorAtual) : '')));
}

const PERIODOS_FARM = [
  { chave: 'hoje', label: 'HOJE' },
  { chave: 'ontem', label: 'ONTEM' },
  { chave: '7d', label: 'ÚLTIMOS 7 DIAS' },
  { chave: '30d', label: 'ÚLTIMOS 30 DIAS' },
  { chave: '90d', label: 'ÚLTIMOS 90 DIAS' },
];

function selectPeriodo() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('farm:selperiodo')
    .setPlaceholder('ESCOLHA UM PERÍODO')
    .addOptions(PERIODOS_FARM.map(p => ({ label: p.label, value: p.chave })));
  return new ActionRowBuilder().addComponents(select);
}

function selectBuscarFarmer() {
  const select = new UserSelectMenuBuilder()
    .setCustomId('farm:buscarfarmer')
    .setPlaceholder('🔎 BUSCAR MEMBRO DO FARM (DISCORD)');
  return new ActionRowBuilder().addComponents(select);
}

function linhaComponentesFarm() {
  return [selectPeriodo(), selectBuscarFarmer(), linhaBotoesFarm()];
}

function celulaStatus(l) {
  if (!l.idFivem) return '❔';
  return l.online ? tema.emoji.ativo : tema.emoji.inativo;
}

function tabelaFarm(linhas) {
  return F.tabela([
    { titulo: '#', valor: (l, i) => String(i + 1), alinhar: 'dir' },
    { titulo: 'MEMBRO', valor: l => l.nome, alinhar: 'esq', larguraMax: 18 },
    { titulo: 'PAPEL', valor: l => (l.papel === 'gestor' ? 'GESTOR' : 'MEMBRO'), alinhar: 'esq' },
    { titulo: 'QTD', valor: l => E.formatarNumero(Math.round(l.quantidade)), alinhar: 'dir' },
    { titulo: 'DEPÓSITOS', valor: l => E.formatarNumero(l.eventos), alinhar: 'dir' },
    { titulo: 'ST', valor: l => celulaStatus(l), alinhar: 'esq' },
  ], linhas);
}

// Quem tem o cargo do departamento Farm (membro ou gestor) — o cargo em si
// vem do banco (departamentos), gerido por /departamentos, nunca hardcoded
// aqui. Sem cargo salvo ainda (setup nunca rodou), devolve lista vazia — o
// painel avisa isso em vez de quebrar.
async function membrosDoFarm(guild) {
  const area = await buscarDepartamento('farm');
  if (!area?.cargo_membro_id) return [];
  await garantirMembrosCarregados(guild);
  const membros = [...guild.members.cache.filter(
    m => m.roles.cache.has(area.cargo_membro_id) || (area.cargo_gestor_id && m.roles.cache.has(area.cargo_gestor_id))
  ).values()];
  return membros.map(m => ({
    discordId: m.id,
    nome: m.displayName,
    idFivem: E.idFivemDoNick(m.nickname ?? m.displayName),
    papel: area.cargo_gestor_id && m.roles.cache.has(area.cargo_gestor_id) ? 'gestor' : 'membro',
  }));
}

// Cruza cargo Farm + quantidade guardada de item de farm (repositorio) +
// status online agora — ordenado por quem mais farmou (empate: mais
// depósitos). Membro sem ID do jogo no apelido entra zerado, não some da
// lista: é exatamente quem precisa vincular o ID pra a liderança enxergar.
async function farmDoPeriodo(guild, periodo, agora = new Date()) {
  const comId = await membrosDoFarm(guild);
  const idsFivem = [...new Set(comId.filter(m => m.idFivem).map(m => m.idFivem))];

  const [totais, estadoAgora] = await Promise.all([
    repo.farmPorAtorNaLista(idsFivem, ITENS_FARM, BAUS_FARM, periodo),
    repo.estadoDosJogadores(agora),
  ]);
  const mapaTotais = new Map(totais.map(t => [t.id, t]));
  const idsOnline = new Set(P.listaOnline(P.estadoSemSessoesExpiradas(estadoAgora, LIMITE_SESSAO_MS, agora)).map(e => e.id));

  const linhas = comId.map(m => {
    const totalMembro = m.idFivem ? mapaTotais.get(m.idFivem) : null;
    return {
      ...m,
      quantidade: totalMembro?.quantidade ?? 0,
      eventos: totalMembro?.eventos ?? 0,
      online: m.idFivem ? idsOnline.has(m.idFivem) : false,
    };
  });
  linhas.sort((a, b) => b.quantidade - a.quantidade || b.eventos - a.eventos);
  return linhas;
}

// Quanto foi guardado por ITEM (maconha, cocaína, matéria-prima...) — soma
// dos membros de farm ou de qualquer sócio/diretor que guardou nos baús
// habilitados, com o "top farmer" (quem mais contribuiu) de cada item. Não
// se limita ao cargo Farm (diferente de farmDoPeriodo): a ideia aqui é ver o
// que de fato entrou, mesmo se veio de fora do time oficial ainda.
async function farmPorItem(periodo) {
  const linhas = await repo.farmPorItemEAtor(ITENS_FARM, BAUS_FARM, periodo);
  const porItem = new Map();
  for (const l of linhas) {
    const atual = porItem.get(l.item) ?? {
      item: l.item, quantidade: 0, eventos: 0, topId: null, topQtd: 0,
    };
    atual.quantidade += l.quantidade;
    atual.eventos += l.eventos;
    if (l.quantidade > atual.topQtd) {
      atual.topQtd = l.quantidade;
      atual.topId = l.id;
    }
    porItem.set(l.item, atual);
  }
  const itens = [...porItem.values()].sort((a, b) => b.quantidade - a.quantidade);
  const idsTop = [...new Set(itens.map(i => i.topId).filter(Boolean))];
  const nomes = idsTop.length ? await repo.nomesPorIds(idsTop) : new Map();
  return itens.map(i => ({ ...i, topNome: i.topId ? (nomes.get(i.topId) ?? i.topId) : null }));
}

function tabelaFarmPorItem(linhas) {
  return F.tabela([
    { titulo: '#', valor: (l, i) => String(i + 1), alinhar: 'dir' },
    { titulo: 'ITEM', valor: l => rotuloItem(l.item), alinhar: 'esq', larguraMax: 12 },
    { titulo: 'QTD', valor: l => E.formatarNumero(Math.round(l.quantidade)), alinhar: 'dir' },
    { titulo: 'DEPÓSITOS', valor: l => E.formatarNumero(l.eventos), alinhar: 'dir' },
    { titulo: 'TOP FARMER', valor: l => l.topNome ?? '—', alinhar: 'esq', larguraMax: 16 },
  ], linhas);
}

function embedRankingFarm(linhas, periodo) {
  const zerados = linhas.filter(l => l.quantidade === 0).length;
  return {
    color: F.COR,
    title: `🏆 FARM — ${periodo.rotulo}`,
    description: [
      `**MEMBROS DO FARM:** ${E.formatarNumero(linhas.length)}`,
      zerados ? `⚠️ **${E.formatarNumero(zerados)}** sem nenhum depósito de farm no período.` : null,
      '',
      linhas.length ? tabelaFarm(linhas) : '*Nenhum membro com o cargo do departamento Farm.*',
    ].filter(Boolean).join('\n'),
    footer: { text: F.rodape('canal logs-baú') },
    timestamp: new Date().toISOString(),
  };
}

function embedFichaFarmer(membro, contagensPorPeriodo, eventosRecentes) {
  const linhas = [];
  for (const p of contagensPorPeriodo) {
    linhas.push(`**${p.rotulo}:** ${E.formatarNumero(Math.round(p.quantidade))} unid. · ${E.formatarNumero(p.eventos)} depósito(s)`);
  }
  linhas.push('', '**ÚLTIMOS DEPÓSITOS:**');
  if (!eventosRecentes.length) {
    linhas.push('*Nenhum depósito de item de farm registrado ainda.*');
  } else {
    for (const ev of eventosRecentes.slice(0, 10)) {
      linhas.push(`• ${E.formatarNumero(Math.round(ev.quantidade))}x **${F.nomeSeguro(rotuloItem(String(ev.item ?? '').toLowerCase()))}** — ${E.formatarDataHora(ev.ocorrido_em)}`);
    }
  }
  return {
    color: F.COR,
    title: `🌾 ${escapeMarkdown(membro.displayName ?? '?')}`,
    description: linhas.join('\n'),
    footer: { text: F.rodape('canal logs-baú') },
    timestamp: new Date().toISOString(),
  };
}

// Devolve o painel fixo (não a resposta ephemeral) pro estado limpo depois de
// uma interação — mesmo motivo de painelRecrutadoresInteracoes#resetarPainelFixo.
function resetarPainelFixo(client) {
  const { agendarAtualizacaoReativa } = require('./painelFarm');
  agendarAtualizacaoReativa(client);
}

registrarModulo('farm', async interaction => {
  const [, acao, a] = interaction.customId.split(':');

  if (interaction.isStringSelectMenu() && acao === 'selperiodo') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    const periodo = E.resolverPeriodo(interaction.values[0]);
    const linhas = await farmDoPeriodo(interaction.guild, periodo);
    await interaction.editReply({ embeds: [embedRankingFarm(linhas, periodo)], allowedMentions: { parse: [] } });
    resetarPainelFixo(interaction.client);
    return;
  }

  if (interaction.isUserSelectMenu() && acao === 'buscarfarmer') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const membro = interaction.members.first();
    const area = await buscarDepartamento('farm');
    const temCargo = membro && area
      && (membro.roles.cache.has(area.cargo_membro_id) || (area.cargo_gestor_id && membro.roles.cache.has(area.cargo_gestor_id)));
    if (!temCargo) {
      resetarPainelFixo(interaction.client);
      return interaction.reply({
        content: `❌ ${membro ?? 'ESSE MEMBRO'} NÃO TEM CARGO DO DEPARTAMENTO FARM.`,
        flags: 64,
        allowedMentions: { parse: [] },
      });
    }
    const idFivem = E.idFivemDoNick(membro.nickname ?? membro.displayName);
    if (!idFivem) {
      resetarPainelFixo(interaction.client);
      return interaction.reply({
        content: `❌ ${membro} NÃO TEM ID DO JOGO NO APELIDO (PADRÃO "... - 1234").`,
        flags: 64,
        allowedMentions: { parse: [] },
      });
    }
    await interaction.deferReply({ flags: 64 });
    const contagensPorPeriodo = await Promise.all(PERIODOS_FICHA_FARM.map(async chave => {
      const periodo = E.resolverPeriodo(chave);
      const [totais] = await repo.farmPorAtorNaLista([idFivem], ITENS_FARM, BAUS_FARM, periodo);
      return { rotulo: periodo.rotulo, quantidade: totais?.quantidade ?? 0, eventos: totais?.eventos ?? 0 };
    }));
    const eventosRecentes = await repo.eventosFarmDoAtor(idFivem, ITENS_FARM, BAUS_FARM, 10);
    await interaction.editReply({ embeds: [embedFichaFarmer(membro, contagensPorPeriodo, eventosRecentes)] });
    resetarPainelFixo(interaction.client);
    return;
  }

  // ── Editar limite diário de retirada (botão → select → modal, ver 1.2) ──
  if (interaction.isButton() && acao === 'editarlimite') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    return interaction.reply({ components: [selectCampoLimite()], flags: 64 });
  }

  if (interaction.isStringSelectMenu() && acao === 'editarlimitecampo') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const campo = CAMPOS_LIMITE.find(c => c.chave === interaction.values[0]);
    if (!campo) return interaction.update({ content: '❌ CAMPO DESCONHECIDO.', components: [] });
    const manual = await lerLimitesFarm();
    return interaction.showModal(modalCampoLimite(campo, manual[campo.chave]?.valor));
  }

  if (interaction.isModalSubmit() && acao === 'editarlimitemodal') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const campo = CAMPOS_LIMITE.find(c => c.chave === a);
    if (!campo) return interaction.reply({ content: '❌ CAMPO DESCONHECIDO.', flags: 64 });
    const texto = interaction.fields.getTextInputValue('valor').trim();
    let novoValor = null;
    if (texto) {
      const n = Number(texto.replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0) {
        return interaction.reply({ content: '❌ USE UM NÚMERO MAIOR QUE ZERO (OU DEIXE EM BRANCO PRO PADRÃO).', flags: 64 });
      }
      novoValor = Math.round(n);
    }
    await gravarLimiteFarm(campo.chave, novoValor == null ? null : {
      valor: novoValor, atualizadoPor: interaction.user.id, atualizadoEm: new Date().toISOString(),
    });
    await interaction.reply({
      content: `**${campo.rotuloCampo}** ${novoValor == null ? `voltou ao padrão (${campo.padrao}/dia)` : `atualizado para ${novoValor}/dia`}.`,
      flags: 64,
    });
    resetarPainelFixo(interaction.client);
    return;
  }

  // ── Atalho pra advertência a partir do alerta de limite excedido ──
  // Reaproveita o fluxo que já existe (utils/advertencia/interacoes.js,
  // customId `select_prazo_adv:<membroId>`) pulando só o passo de
  // selecionar o membro — a gente já sabe quem foi pelo log. Motivo/punição/
  // prazo continuam no modal de lá, nada duplicado.
  if (interaction.isButton() && acao === 'advertir') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`select_prazo_adv:${a}`)
        .setPlaceholder('SELECIONE O PRAZO DE PAGAMENTO')
        .addOptions([
          { label: '⚙️ TESTE (1 SEGUNDO)', value: 'test' },
          { label: '1 DIA', value: '1' },
          { label: '2 DIAS', value: '2' },
          { label: '3 DIAS', value: '3' },
        ])
    );
    return interaction.reply({
      content: `**⛔ REGISTRAR ADVERTÊNCIA** para <@${a}> — SELECIONE O PRAZO DE PAGAMENTO:`,
      components: [row],
      flags: 64,
      allowedMentions: { parse: [] },
    });
  }
});

module.exports = {
  linhaComponentesFarm,
  farmDoPeriodo,
  tabelaFarm,
  membrosDoFarm,
  farmPorItem,
  tabelaFarmPorItem,
  rotuloItem,
  limitesEfetivosFarm,
  CAMPOS_LIMITE,
  PERIODO_PADRAO,
};
