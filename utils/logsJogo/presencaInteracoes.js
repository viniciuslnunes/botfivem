const crypto = require('crypto');
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const { lerConfig, gravarConfig } = require('../botConfig');
const E = require('./estatisticas');
const relatorios = require('./relatorios');

// Chave no bot_config pros números batidos à mão (painel/ranking do jogo)
// que aparecem fixos no painel, ao lado dos automáticos. Exportada porque
// painelJogadores.js precisa dela pra montar o embed.
const CONFIG_KEY_MANUAL = 'painel_jogadores_manual';

// Padrão "editar dado fixo do painel": botão EDITAR → select do campo → modal
// só com aquele campo, valor atual já preenchido. Ver
// docs/plano-modulos-torcida.md § "Edição de dado manual num painel fixo"
// pra replicar em outro painel — não inventar um fluxo novo por módulo.
// Cada entrada aqui vira uma opção do select e um modal de um campo só.
const CAMPOS_MANUAIS = [
  { chave: 'socios', rotuloSelect: 'Sócios no painel do jogo', rotuloCampo: 'SÓCIOS NO PAINEL DO JOGO' },
  { chave: 'pico', rotuloSelect: 'Maior pico no ranking do jogo', rotuloCampo: 'MAIOR PICO NO RANKING DO JOGO' },
];

// Botões do painel fixo de jogadores: cada um abre, só pra quem clicou, uma
// consulta paginada (mesmo padrão do /logs) já filtrada num período. Duas
// linhas: janela rolante (a partir de agora) e período civil fechado (o
// anterior).
const LINHA_ROLANTE = [
  { chave: 'hoje', label: 'AGORA' },
  { chave: '7d', label: 'ÚLTIMOS 7 DIAS' },
  { chave: '30d', label: 'ÚLTIMOS 30 DIAS' },
];
const LINHA_FECHADA = [
  { chave: 'ontem', label: 'ONTEM' },
  { chave: 'semana_passada', label: 'SEMANA PASSADA' },
  { chave: 'mes_passado', label: 'MÊS PASSADO' },
];

function linhaDeBotoes(botoes) {
  return new ActionRowBuilder().addComponents(
    ...botoes.map(b => new ButtonBuilder()
      .setCustomId(`presenca:ver:${b.chave}`)
      .setLabel(b.label)
      .setStyle(ButtonStyle.Secondary))
  );
}

// Botão à parte pra abrir a edição dos números manuais (painel/ranking do
// jogo) — só a liderança consegue usar, checado no handler.
function linhaBotaoEditar() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('presenca:editar')
      .setLabel('EDITAR')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Secondary)
  );
}

function linhaBotoesPresenca() {
  return [linhaDeBotoes(LINHA_ROLANTE), linhaDeBotoes(LINHA_FECHADA), linhaBotaoEditar()];
}

// Passo 1 (ephemeral, só quem clicou EDITAR vê): qual campo alterar.
function selectCampoManual() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('presenca:editarcampo')
    .setPlaceholder('SELECIONE O CAMPO PARA EDITAR')
    .addOptions(CAMPOS_MANUAIS.map(c => ({ label: c.rotuloSelect, value: c.chave })));
  return new ActionRowBuilder().addComponents(select);
}

// Passo 2: modal com um campo só, valor atual já preenchido. Cancelar/Enviar
// são os botões nativos do modal do Discord — não precisa desenhar nenhum.
function modalCampoManual(campo, valorAtual) {
  return new ModalBuilder()
    .setCustomId(`presenca:editarmodal:${campo.chave}`)
    .setTitle('EDITAR DADO DO PAINEL')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('valor').setLabel(campo.rotuloCampo)
      .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(10)
      .setPlaceholder('Deixe em branco pra remover')
      .setValue(valorAtual != null ? String(valorAtual) : '')));
}

// Aceita "1.234", "1234" etc.; vazio vira null (remove o valor manual).
// Qualquer coisa que não seja um inteiro não-negativo é rejeitada.
function lerInteiroOuNulo(texto) {
  const limpo = texto.trim().replace(/\./g, '');
  if (!limpo) return { valor: null };
  if (!/^\d+$/.test(limpo)) return { erro: true };
  return { valor: Number(limpo) };
}

async function lerManualAtual() {
  try {
    const bruto = await lerConfig(CONFIG_KEY_MANUAL);
    return bruto ? JSON.parse(bruto) : {};
  } catch {
    return {};
  }
}

// Consulta paginada: a lista inteira (quem está online, ou o ranking de
// tempo jogado) fica em memória, identificada no customId dos botões — uma
// lista de centenas de jogadores não cabe num embed só.
const POR_PAGINA = 25;
const TTL_MS = 15 * 60 * 1000;
const consultas = new Map();

function limparExpiradas() {
  const agora = Date.now();
  for (const [id, consulta] of consultas) {
    if (agora - consulta.criadoEm > TTL_MS) consultas.delete(id);
  }
}

// Sessão atual (AGORA): nome + ID + "desde <tempo relativo>" (o Discord
// mantém isso atualizado sozinho). Ranking de um período: posição + nome +
// ID + duração formatada.
function linhaDaEntrada(entrada, indice, ehAgora) {
  const nome = entrada.nome ?? '?';
  if (ehAgora) {
    const desde = Math.floor(new Date(entrada.desde).getTime() / 1000);
    return `**${nome}** \`${entrada.id}\` · desde <t:${desde}:R>`;
  }
  return `${indice + 1}. **${nome}** \`${entrada.id}\` — ${E.formatarDuracao(entrada.ms)}`;
}

// Select entre a lista e os botões de página: filtra por ID dentro das até
// 25 entradas DESTA página (o próprio limite do select do Discord já bate
// com o tamanho da página) e mostra só o registro daquele jogador.
function selectFiltrarPagina(consultaId, fatiaEntradas, ehAgora) {
  if (!fatiaEntradas.length) return null;
  const select = new StringSelectMenuBuilder()
    .setCustomId(`presenca:sel:${consultaId}`)
    .setPlaceholder('FILTRAR UM JOGADOR DESTA PÁGINA POR ID')
    .addOptions(fatiaEntradas.map(e => ({
      label: (e.nome ?? '?').slice(0, 100),
      value: e.id,
      description: (ehAgora ? `ID ${e.id} · online há ${E.formatarDuracao(e.ms)}` : `ID ${e.id} · ${E.formatarDuracao(e.ms)}`).slice(0, 100),
    })));
  return new ActionRowBuilder().addComponents(select);
}

function renderizarPagina(consultaId, consulta, pagina) {
  const total = consulta.entradas.length;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const atual = Math.min(Math.max(0, pagina), totalPaginas - 1);
  const fatia = consulta.entradas.slice(atual * POR_PAGINA, (atual + 1) * POR_PAGINA);
  const linhas = fatia.map((e, i) => linhaDaEntrada(e, atual * POR_PAGINA + i, consulta.ehAgora));

  const embed = {
    color: 0x000000,
    title: consulta.titulo,
    description: consulta.linhaTopo,
    fields: [
      consulta.resumo,
      { name: `${consulta.tituloLista} (${E.formatarNumero(total)})`, value: linhas.join('\n') || '*Sem dados.*', inline: false },
    ],
    footer: { text: `Com base nos logs do jogo recebidos pelo webhook · canal logs-painel · Página ${atual + 1}/${totalPaginas}` },
  };
  const selectRow = selectFiltrarPagina(consultaId, fatia, consulta.ehAgora);
  const botoes = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`presenca:pag:${consultaId}:${atual - 1}`)
      .setLabel('◀ ANTERIOR')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atual === 0),
    new ButtonBuilder()
      .setCustomId(`presenca:pag:${consultaId}:${atual + 1}`)
      .setLabel('PRÓXIMA ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atual >= totalPaginas - 1)
  );
  return { embeds: [embed], components: selectRow ? [selectRow, botoes] : [botoes], allowedMentions: { parse: [] } };
}

// Ficha de um jogador só, a partir do ID escolhido no select — busca na
// consulta inteira (não só na página), então funciona mesmo que a página
// tenha mudado entre montar o select e escolher a opção.
function embedFichaJogador(consulta, entrada) {
  const posicao = consulta.entradas.findIndex(e => e.id === entrada.id) + 1;
  const linhas = [`**ID:** \`${entrada.id}\``];
  if (consulta.ehAgora) {
    const desde = Math.floor(new Date(entrada.desde).getTime() / 1000);
    linhas.push(`**Online desde:** <t:${desde}:R> (<t:${desde}:f>)`, `**Sessão atual:** ${E.formatarDuracao(entrada.ms)}`);
  } else {
    linhas.push(`**Tempo jogado no período:** ${E.formatarDuracao(entrada.ms)}`, `**Posição no ranking:** #${posicao} de ${consulta.entradas.length}`);
  }
  return {
    color: 0x000000,
    title: `🎮 ${entrada.nome ?? '?'} — ${consulta.titulo.replace('🎮 PRESENÇA DE JOGADORES — ', '')}`,
    description: linhas.join('\n'),
  };
}

async function abrirPresenca(interaction, periodo) {
  limparExpiradas();
  const dados = await relatorios.montarDadosPresenca(periodo);
  const consultaId = crypto.randomBytes(6).toString('hex');
  const consulta = { ...dados, userId: interaction.user.id, criadoEm: Date.now() };
  consultas.set(consultaId, consulta);
  await interaction.editReply(renderizarPagina(consultaId, consulta, 0));
}

registrarModulo('presenca', async interaction => {
  const [, acao, a, b] = interaction.customId.split(':');

  if (interaction.isButton() && acao === 'ver') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    await abrirPresenca(interaction, E.resolverPeriodo(a));
    return;
  }

  if (interaction.isButton() && acao === 'pag') {
    const consulta = consultas.get(a);
    if (!consulta || Date.now() - consulta.criadoEm > TTL_MS) {
      return interaction.update({ content: '⌛ ESTA CONSULTA EXPIROU. CLIQUE NO PERÍODO DE NOVO.', embeds: [], components: [] });
    }
    if (consulta.userId !== interaction.user.id) {
      return interaction.reply({ content: '❌ ESSA CONSULTA NÃO É SUA.', flags: 64 });
    }
    await interaction.deferUpdate();
    await interaction.editReply(renderizarPagina(a, consulta, Number(b) || 0));
    return;
  }

  if (interaction.isStringSelectMenu() && acao === 'sel') {
    const consulta = consultas.get(a);
    if (!consulta || Date.now() - consulta.criadoEm > TTL_MS) {
      return interaction.reply({ content: '⌛ ESTA CONSULTA EXPIROU. CLIQUE NO PERÍODO DE NOVO.', flags: 64 });
    }
    if (consulta.userId !== interaction.user.id) {
      return interaction.reply({ content: '❌ ESSA CONSULTA NÃO É SUA.', flags: 64 });
    }
    const entrada = consulta.entradas.find(e => e.id === interaction.values[0]);
    if (!entrada) return interaction.reply({ content: '❌ JOGADOR NÃO ENCONTRADO NESTA CONSULTA.', flags: 64 });
    return interaction.reply({ embeds: [embedFichaJogador(consulta, entrada)], flags: 64, allowedMentions: { parse: [] } });
  }

  if (interaction.isButton() && acao === 'editar') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    return interaction.reply({ content: '✏️ QUAL CAMPO VOCÊ QUER EDITAR?', components: [selectCampoManual()], flags: 64 });
  }

  if (interaction.isStringSelectMenu() && acao === 'editarcampo') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const campo = CAMPOS_MANUAIS.find(c => c.chave === interaction.values[0]);
    if (!campo) return interaction.update({ content: '❌ CAMPO DESCONHECIDO.', components: [] });
    const manual = await lerManualAtual();
    return interaction.showModal(modalCampoManual(campo, manual[campo.chave]?.valor));
  }

  if (interaction.isModalSubmit() && acao === 'editarmodal') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const campo = CAMPOS_MANUAIS.find(c => c.chave === a);
    if (!campo) return interaction.reply({ content: '❌ CAMPO DESCONHECIDO.', flags: 64 });
    const lido = lerInteiroOuNulo(interaction.fields.getTextInputValue('valor'));
    if (lido.erro) return interaction.reply({ content: '❌ USE SÓ NÚMEROS (EX.: 1234 OU 1.234).', flags: 64 });

    // Lê de novo bem antes de gravar: dois campos são editados em modais
    // separados, então só mexe na chave deste campo, sem sobrescrever a do
    // outro com um valor desatualizado.
    const manual = await lerManualAtual();
    manual[campo.chave] = lido.valor == null ? null : {
      valor: lido.valor,
      atualizadoPor: interaction.user.id,
      atualizadoEm: new Date().toISOString(),
    };
    await gravarConfig(CONFIG_KEY_MANUAL, JSON.stringify(manual));
    await interaction.reply({ content: `✅ **${campo.rotuloCampo}** atualizado.`, flags: 64 });
    // Requerido aqui dentro (não no topo do arquivo) pra evitar ciclo de
    // require com painelJogadores.js, que importa este módulo pelos botões.
    const { atualizarPainelJogadores } = require('./painelJogadores');
    await atualizarPainelJogadores(interaction.client);
  }
});

module.exports = { linhaBotoesPresenca, abrirPresenca, CONFIG_KEY_MANUAL };
