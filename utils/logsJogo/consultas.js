const crypto = require('crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca } = require('../permissoes');
const repo = require('./repositorio');
const E = require('./estatisticas');
const tema = require('../../tema');

// Consulta paginada de /logs. O filtro fica em memória por 15 min, identificado
// no customId dos botões (o customId do Discord tem só 100 caracteres).
const POR_PAGINA = 10;
const TTL_MS = 15 * 60 * 1000;
const consultas = new Map();

function limparExpiradas() {
  const agora = Date.now();
  for (const [id, consulta] of consultas) {
    if (agora - consulta.criadoEm > TTL_MS) consultas.delete(id);
  }
}

function pessoa(nome, id) {
  if (!nome && !id) return null;
  return `${nome ?? '?'}${id ? ` (${id})` : ''}`;
}

function linhaDoLog(log) {
  const quando = `<t:${Math.floor(new Date(log.ocorrido_em).getTime() / 1000)}:f>`;
  const alvo = pessoa(log.alvo_nome, log.alvo_id_fivem);
  const partes = [
    quando,
    log.categoria ? `\`${log.categoria}\`` : null,
    log.acao !== 'desconhecido' ? `**${log.acao}**` : null,
    pessoa(log.ator_nome, log.ator_id_fivem),
    alvo ? `→ ${alvo}` : null,
    log.valor != null ? E.formatarDinheiro(log.valor) : null,
  ].filter(Boolean);
  const texto = log.descricao ? `\n> ${E.truncar(log.descricao, 160)}` : '';
  return `${partes.join(' · ')}${texto}`;
}

async function renderizarPagina(consultaId, consulta, pagina) {
  const { total, pagina: atual, itens } = await repo.buscarLogs(consulta.filtro, pagina, POR_PAGINA);
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  const embed = {
    color: tema.cor.primaria,
    title: '📜 LOGS DO JOGO',
    description: itens.length
      ? E.truncar(itens.map(linhaDoLog).join('\n\n'), 4096)
      : '*Nenhum log encontrado com esses filtros.*',
    footer: { text: E.truncar(`Página ${atual + 1}/${totalPaginas} · ${E.formatarNumero(total)} registros · ${consulta.rotulo}`, 2048) },
  };
  const botoes = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`logs:pag:${consultaId}:${atual - 1}`)
      .setLabel('◀ ANTERIOR')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atual === 0),
    new ButtonBuilder()
      .setCustomId(`logs:pag:${consultaId}:${atual + 1}`)
      .setLabel('PRÓXIMA ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atual >= totalPaginas - 1)
  );
  return { embeds: [embed], components: total > POR_PAGINA ? [botoes] : [], allowedMentions: { parse: [] } };
}

async function abrirConsulta(interaction, filtro, rotulo) {
  limparExpiradas();
  const consultaId = crypto.randomBytes(6).toString('hex');
  const consulta = { filtro, rotulo, userId: interaction.user.id, criadoEm: Date.now() };
  consultas.set(consultaId, consulta);
  await interaction.editReply(await renderizarPagina(consultaId, consulta, 0));
}

registrarModulo('logs', async interaction => {
  const [, acao, consultaId, paginaBruta] = interaction.customId.split(':');
  if (acao !== 'pag' || !interaction.isButton()) return;

  const consulta = consultas.get(consultaId);
  if (!consulta || Date.now() - consulta.criadoEm > TTL_MS) {
    return interaction.update({ content: '⌛ ESTA CONSULTA EXPIROU. RODE /logs DE NOVO.', embeds: [], components: [] });
  }
  if (consulta.userId !== interaction.user.id || !ehLideranca(interaction.member)) {
    return interaction.reply({ content: '❌ ESSA CONSULTA NÃO É SUA.', flags: 64 });
  }
  await interaction.deferUpdate();
  await interaction.editReply(await renderizarPagina(consultaId, consulta, Number(paginaBruta) || 0));
});

// Membro do Discord → ID FiveM pelo apelido, ou ID informado direto
async function resolverIdFivem(interaction) {
  const idInformado = interaction.options.getString('id')?.trim();
  if (idInformado) {
    if (!/^\d{1,8}$/.test(idInformado)) return { erro: '❌ O ID FIVEM DEVE CONTER APENAS NÚMEROS.' };
    return { idFivem: idInformado, rotulo: `ID ${idInformado}` };
  }
  const usuario = interaction.options.getUser('membro');
  if (!usuario) return { idFivem: null, rotulo: null };
  const membro = await interaction.guild.members.fetch(usuario.id).catch(() => null);
  const idFivem = E.idFivemDoNick(membro?.nickname ?? membro?.displayName);
  if (!idFivem) {
    return { erro: `❌ O APELIDO DE ${usuario} NÃO TEM ID FIVEM NO PADRÃO \`${tema.marca.nickPrefixo}NOME - ID\`. USE A OPÇÃO \`id\`.` };
  }
  return { idFivem, rotulo: `${membro.displayName} (ID ${idFivem})` };
}

async function autocompletarFiltro(interaction) {
  if (!ehLideranca(interaction.member)) return interaction.respond([]);
  const focado = interaction.options.getFocused(true);
  const buscar = { categoria: repo.categoriasDistintas, acao: repo.acoesDistintas }[focado.name];
  if (!buscar) return interaction.respond([]);
  const valores = await buscar(String(focado.value ?? ''));
  return interaction.respond(valores.slice(0, 25).map(v => ({ name: v.slice(0, 100), value: v.slice(0, 100) })));
}

module.exports = { abrirConsulta, resolverIdFivem, autocompletarFiltro };
