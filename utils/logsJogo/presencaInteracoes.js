const crypto = require('crypto');
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, UserSelectMenuBuilder, escapeMarkdown,
} = require('discord.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const { lerConfig } = require('../botConfig');
const { aplicarIdNoNick } = require('../formatarNick');
const db = require('../db');
const E = require('./estatisticas');
const relatorios = require('./relatorios');
const { gerarGraficoOcupacao } = require('./graficoOcupacao');
const { incrementarContadorVinculados } = require('./painelSociosSemId');

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
  {
    chave: 'socios', rotuloSelect: 'Sócios setados', rotuloCampo: 'SÓCIOS SETADOS',
    // Também soma sozinho, na hora, a cada recrutamento que o próprio jogo
    // loga no webhook (ver incrementarSociosManual, chamado por
    // events/messageCreate.js) — editar aqui só ajusta o número na mão por
    // cima disso, não substitui a soma automática.
    descricaoSelect: 'Some sozinho a cada recrutamento do webhook — editar aqui só ajusta por cima',
  },
  { chave: 'pico', rotuloSelect: 'Maior bonde mensal', rotuloCampo: 'MAIOR BONDE MENSAL' },
];

// Botões do painel fixo de jogadores viraram um select (eram 6 botões — 2
// linhas cheias só pra escolher um período, poluição visual). Ordem
// cronológica (do mais recente/curto pro mais antigo/longo). Só janela
// rolante — o par "X passado" saiu daqui: não é período civil de verdade,
// só o bloco anterior de mesma duração, e ficava parecendo sinônimo de
// "últimos N dias" (12 opções pra só 7 ideias diferentes). "Ontem" continua
// por ser sempre um dia civil fechado, sem essa ambiguidade.
const PERIODOS_PRESENCA = [
  { chave: 'hoje', label: 'AGORA' },
  { chave: 'ontem', label: 'ONTEM' },
  { chave: '7d', label: 'ÚLTIMOS 7 DIAS' },
  { chave: '30d', label: 'ÚLTIMOS 30 DIAS' },
  { chave: '90d', label: 'ÚLTIMOS 90 DIAS' },
  { chave: '180d', label: 'ÚLTIMOS 6 MESES' },
  { chave: '365d', label: 'ÚLTIMOS 12 MESES' },
];

function selectPeriodo() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('presenca:selperiodo')
    .setPlaceholder('ESCOLHA UM PERÍODO')
    .addOptions(PERIODOS_PRESENCA.map(p => ({ label: p.label, value: p.chave })));
  return new ActionRowBuilder().addComponents(select);
}

// Select nativo do Discord (busca com autocomplete pelos membros do
// servidor) pra abrir a ficha de um jogador direto, sem escolher período
// antes — resolve o ID do jogo a partir do apelido (padrão "... - 1234").
function selectBuscarJogador() {
  const select = new UserSelectMenuBuilder()
    .setCustomId('presenca:buscarjogador')
    .setPlaceholder('🔎 BUSCAR JOGADOR (DISCORD)');
  return new ActionRowBuilder().addComponents(select);
}

// Botão pra abrir a edição dos números manuais (painel/ranking do jogo),
// botão pra ver o top 10 de tempo jogado de um período e botão pra vincular/
// corrigir o ID FiveM de um membro no apelido — os três só a liderança
// consegue usar, checado no handler.
function linhaBotoesAcao() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('presenca:editar')
      .setLabel('EDITAR')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('presenca:ranking')
      .setLabel('RANKING')
      .setEmoji('🏆')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('presenca:vincularid')
      .setLabel('VINCULAR ID')
      .setEmoji('🆔')
      .setStyle(ButtonStyle.Secondary)
  );
}

// Passo 1 do botão VINCULAR ID (ephemeral): qual membro. Select nativo do
// Discord (mesmo tipo do buscarjogador), não depende de o membro já ter ID
// no apelido — é exatamente quem não tem que esse fluxo resolve.
function selectVincularIdUsuario() {
  const select = new UserSelectMenuBuilder()
    .setCustomId('presenca:vincularidusuario')
    .setPlaceholder('SELECIONE O MEMBRO PARA VINCULAR/CORRIGIR O ID');
  return new ActionRowBuilder().addComponents(select);
}

// Passo 2: modal com o ID atual (se já tiver um) já preenchido, pra edição
// virar só trocar o número. Sem ID, o campo some vazio — replica exatamente
// o que o fluxo de recrutamento faz no apelido ao aprovar (ver
// events/interactionCreate.js, formatarNick), só que a partir de um membro
// que já está no servidor.
function modalVincularId(discordUserId, idAtual) {
  return new ModalBuilder()
    .setCustomId(`presenca:vincularidmodal:${discordUserId}`)
    .setTitle(idAtual ? 'ALTERAR ID FIVEM' : 'VINCULAR ID FIVEM')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('id').setLabel('ID FIVEM (APENAS NÚMEROS)')
      .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(8)
      .setValue(idAtual ?? '')));
}

// Passo 1 do botão RANKING (ephemeral, só quem clicou vê): qual período.
// Mesma lista de PERIODOS_PRESENCA — o ranking é o mesmo dado do select de
// período, só que já cortado nos 10 primeiros, sem paginação.
function selectPeriodoRanking() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('presenca:selrankingperiodo')
    .setPlaceholder('ESCOLHA UM PERÍODO PARA O RANKING')
    .addOptions(PERIODOS_PRESENCA.map(p => ({ label: p.label, value: p.chave })));
  return new ActionRowBuilder().addComponents(select);
}

function linhaBotoesPresenca() {
  return [selectPeriodo(), selectBuscarJogador(), linhaBotoesAcao()];
}

// Passo 1 (ephemeral, só quem clicou EDITAR vê): qual campo alterar.
function selectCampoManual() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('presenca:editarcampo')
    .setPlaceholder('SELECIONE O CAMPO PARA EDITAR')
    .addOptions(CAMPOS_MANUAIS.map(c => ({ label: c.rotuloSelect, value: c.chave, description: c.descricaoSelect })));
  return new ActionRowBuilder().addComponents(select);
}

// Passo 2: modal com um campo só, valor atual já preenchido. Cancelar/Enviar
// são os botões nativos do modal do Discord — não precisa desenhar nenhum.
function modalCampoManual(campo, valorAtual) {
  return new ModalBuilder()
    .setCustomId(`presenca:editarmodal:${campo.chave}`)
    .setTitle('RANKING')
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

// Único jeito de mexer em "SÓCIOS SETADOS" que não passa pelo botão EDITAR
// (select→modal, CAMPOS_MANUAIS): o log de "fulano recrutou beltrano" do
// canal logsJogo.canalRecrutamentoJogo chama isso direto (ver
// events/messageCreate.js), somando 1 por recrutamento novo. Preserva
// quem/quando da última edição manual — só o valor muda.
//
// Feito num UPDATE/INSERT só (jsonb_set direto no Postgres), não
// ler→somar→gravar em JS: o webhook pode mandar várias mensagens de log em
// rajada (várias entrando quase juntas), cada uma virando uma chamada
// concorrente daqui. Ler→somar→gravar em JS tem uma janela entre o read e o
// write onde duas chamadas leem o mesmo valor e uma soma se perde (a que
// grava por último "vence" e apaga o incremento da outra) — o painel ficava
// mostrando um número e o formulário de EDITAR abria com outro, mais baixo,
// porque o valor persistido no banco tinha ficado pra trás. Uma única
// instrução SQL pega lock de linha no Postgres, então as chamadas
// concorrentes serializam e nenhum incremento se perde.
// Grava um campo só de `manual` (jsonb_set atômico, mesmo motivo de
// incrementarSociosManual acima) sem tocar no resto do objeto — não lê o
// objeto inteiro pra devolver na hora de gravar, então não tem como essa
// edição manual pisar num incremento automático (ou vice-versa) que
// aconteceu no meio do caminho. `valorObj` null remove a chave (campo sem
// valor batido à mão).
async function gravarCampoManual(chave, valorObj) {
  if (valorObj == null) {
    await db.query(
      `INSERT INTO bot_config (key, value) VALUES ($1, '{}')
       ON CONFLICT (key) DO UPDATE SET value = (COALESCE(bot_config.value::jsonb, '{}'::jsonb) - $2)::text`,
      [CONFIG_KEY_MANUAL, chave]
    );
    return;
  }
  await db.query(
    `INSERT INTO bot_config (key, value)
     VALUES ($1, jsonb_set('{}'::jsonb, ARRAY[$2], $3::jsonb)::text)
     ON CONFLICT (key) DO UPDATE SET value = jsonb_set(
       COALESCE(bot_config.value::jsonb, '{}'::jsonb), ARRAY[$2], $3::jsonb
     )::text`,
    [CONFIG_KEY_MANUAL, chave, JSON.stringify(valorObj)]
  );
}

async function incrementarSociosManual(incremento) {
  if (!incremento) return;
  await db.query(
    `INSERT INTO bot_config (key, value)
     VALUES ($2, jsonb_set('{}'::jsonb, '{socios,valor}', to_jsonb($1::bigint))::text)
     ON CONFLICT (key) DO UPDATE SET value = jsonb_set(
       COALESCE(bot_config.value::jsonb, '{}'::jsonb),
       '{socios,valor}',
       to_jsonb(COALESCE((bot_config.value::jsonb->'socios'->>'valor')::bigint, 0) + $1::bigint)
     )::text`,
    [incremento, CONFIG_KEY_MANUAL]
  );
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
// escapeMarkdown: apelido vem cru do jogo (webhook), sem sanitização — um
// nome com "**", "||" ou "`" quebra a formatação da linha (ex.: "||" sem par
// vira spoiler que engole o resto da lista até achar outro "||" mais abaixo,
// sumindo com posições inteiras sem erro nenhum no log; ver registrosDiarios.js).
function linhaDaEntrada(entrada, indice, ehAgora) {
  const nome = escapeMarkdown(entrada.nome ?? '?');
  if (ehAgora) {
    const desde = Math.floor(new Date(entrada.desde).getTime() / 1000);
    return `**${nome}** \`${entrada.id}\` · desde <t:${desde}:R>`;
  }
  return `${indice + 1}. **${nome}** \`${entrada.id}\` — ${E.formatarDuracao(entrada.ms)}`;
}

// Select nativo do Discord (mesmo tipo do buscarjogador) pra filtrar um
// jogador desta página direto pelo membro do Discord — reativo pela busca
// nativa do cliente entre TODOS os membros do servidor, não só os 25 da
// página. Resolve o ID do jogo pelo apelido (padrão "... - 1234").
function selectFiltrarPorId(consultaId) {
  const select = new UserSelectMenuBuilder()
    .setCustomId(`presenca:selusuario:${consultaId}`)
    .setPlaceholder('FILTRAR UM JOGADOR DESTA PÁGINA POR ID');
  return new ActionRowBuilder().addComponents(select);
}

// Select que lista até 25 entradas (label + descrição com o ID) e, ao
// escolher uma, mostra a ficha daquele jogador — usado no resultado da busca
// por nome/ID (modal), que cobre a consulta inteira e pode incluir jogador
// que já nem está mais no servidor Discord (por isso StringSelect, não
// UserSelect: esse aqui não depende de o jogador ser membro).
function selectDeEntradas(consultaId, entradas, ehAgora, placeholder) {
  if (!entradas.length) return null;
  const select = new StringSelectMenuBuilder()
    .setCustomId(`presenca:sel:${consultaId}`)
    .setPlaceholder(placeholder)
    .addOptions(entradas.slice(0, 25).map(e => ({
      label: (e.nome ?? '?').slice(0, 100),
      value: e.id,
      description: (ehAgora ? `ID ${e.id} · online há ${E.formatarDuracao(e.ms)}` : `ID ${e.id} · ${E.formatarDuracao(e.ms)}`).slice(0, 100),
    })));
  return new ActionRowBuilder().addComponents(select);
}

// Filtra por nome (contém, sem diferenciar maiúsc./acento) ou ID (contém os
// dígitos digitados) em TODAS as entradas da consulta, não só na página
// atual — é o que resolve buscar entre os 256 jogadores, não só os 25
// visíveis na tela.
function normalizar(texto) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function buscarEntradas(consulta, termoBruto) {
  const termo = normalizar(termoBruto.trim());
  if (!termo) return [];
  return consulta.entradas.filter(e =>
    normalizar(e.nome ?? '').includes(termo) || String(e.id).includes(termo)
  );
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
  // Gráfico de barras (imagem) da variação de pico por hora/dia, no lugar do
  // sparkline em texto — some quando o período não teve nenhum pico > 0
  // (relatorios.js já devolve `serie: null` nesse caso). Gerado uma vez só
  // por consulta e cacheado nela: a série não muda entre páginas, então não
  // tem por quê redesenhar o canvas a cada clique de paginação/busca — mas
  // o attachment precisa ser reenviado em toda edição de mensagem, porque o
  // Discord não reaproveita anexo de uma edição anterior sozinho.
  let files;
  if (consulta.serie?.length) {
    if (!consulta._graficoBuffer) {
      consulta._graficoBuffer = gerarGraficoOcupacao(consulta.serie, consulta.unidadeSerie, { chaveAtual: consulta.chaveAtual });
    }
    embed.image = { url: 'attachment://ocupacao.png' };
    files = [{ attachment: consulta._graficoBuffer, name: 'ocupacao.png' }];
  }
  const selectRow = selectFiltrarPorId(consultaId);
  const temAnterior = atual > 0;
  const temProxima = atual < totalPaginas - 1;
  const botoes = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`presenca:pag:${consultaId}:${atual - 1}`)
      // Sem página anterior/seguinte, não tem número de destino válido pra
      // mostrar (seria "página 0" ou "página totalPaginas+1") — legenda
      // simples no botão desabilitado, número só quando ele leva a algum lugar.
      .setLabel(temAnterior ? `◀ ANTERIOR (${atual}/${totalPaginas})` : '◀ ANTERIOR')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!temAnterior),
    new ButtonBuilder()
      .setCustomId(`presenca:pag:${consultaId}:${atual + 1}`)
      .setLabel(temProxima ? `PRÓXIMA ▶ (${atual + 2}/${totalPaginas})` : 'PRÓXIMA ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!temProxima),
    new ButtonBuilder()
      .setCustomId(`presenca:buscar:${consultaId}`)
      .setLabel('🔎 BUSCAR')
      .setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [selectRow, botoes], files, allowedMentions: { parse: [] } };
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
    title: `🎮 ${escapeMarkdown(entrada.nome ?? '?')} — ${consulta.titulo.replace('🎮 PRESENÇA DE JOGADORES — ', '')}`,
    description: linhas.join('\n'),
  };
}

const MEDALHAS = ['🥇', '🥈', '🥉'];

// Top 10 de tempo jogado de um período — mesmo dado do select de período
// (montarDadosPresenca), só que cortado nos 10 primeiros, sem paginação.
// Pro período "AGORA" as entradas vêm em ordem alfabética (útil pra achar
// alguém), então reordena por tempo de sessão só aqui, pro ranking bater com
// "quem está online há mais tempo" em vez de A-Z.
function embedRanking(dados) {
  const ordenadas = dados.ehAgora ? [...dados.entradas].sort((a, b) => b.ms - a.ms) : dados.entradas;
  const top10 = ordenadas.slice(0, 10);
  const linhas = top10.map((e, i) =>
    `${MEDALHAS[i] ?? `${i + 1}.`} **${escapeMarkdown(e.nome ?? '?')}** \`${e.id}\` — ${E.formatarDuracao(e.ms)}`);
  return {
    color: 0x000000,
    title: `🏆 RANKING — ${dados.titulo.replace('🎮 PRESENÇA DE JOGADORES — ', '')}`,
    description: dados.linhaTopo,
    fields: [{
      name: `TOP ${top10.length} DE ${E.formatarNumero(dados.entradas.length)}${dados.ehAgora ? ' — TEMPO DE SESSÃO' : ' — TEMPO JOGADO'}`,
      value: linhas.join('\n') || '*Sem dados no período.*',
      inline: false,
    }],
    footer: { text: 'Com base nos logs do jogo recebidos pelo webhook · canal logs-painel' },
    timestamp: new Date().toISOString(),
  };
}

// Ficha de um jogador buscado direto pelo select de membro do painel fixo
// (sem passar por nenhum período antes): tempo jogado nos mesmos 6 períodos
// dos botões antigos, tudo junto — dado bruto vem de relatorios.js
// (montarFichaCompletaJogador).
function embedFichaCompleta(membro, ficha) {
  const linhas = [`**ID do jogo:** \`${ficha.idFivem}\``];
  linhas.push(ficha.sessaoAtual
    ? `**AGORA:** online desde <t:${Math.floor(new Date(ficha.sessaoAtual.desde).getTime() / 1000)}:R> — ${E.formatarDuracao(ficha.sessaoAtual.ms)}`
    : '**AGORA:** offline');
  for (const p of ficha.porPeriodo) {
    linhas.push(`**${p.rotulo}:** ${E.formatarDuracao(p.ms)}`);
  }
  return {
    color: 0x000000,
    title: `🎮 ${membro.displayName ?? ficha.nome ?? '?'}`,
    description: linhas.join('\n'),
    footer: { text: 'Com base nos logs do jogo recebidos pelo webhook · canal logs-painel' },
    timestamp: new Date().toISOString(),
  };
}

function modalBuscarJogador(consultaId) {
  return new ModalBuilder()
    .setCustomId(`presenca:buscarmodal:${consultaId}`)
    .setTitle('BUSCAR JOGADOR')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('termo').setLabel('NOME OU ID DO JOGADOR')
      .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)));
}

// Devolve o painel fixo (o do canal, não a consulta ephemeral) pro estado
// limpo depois de escolher um período ou buscar um jogador — os dois
// selects moram na mesma mensagem, então sem isso a opção escolhida fica
// "presa" visualmente no componente, parecendo (errado) que os dois
// filtros estão combinados. Debounced (agendarAtualizacaoReativa), então
// vários cliques em sequência viram uma edição só. Requerido aqui dentro
// (não no topo do arquivo) pra evitar ciclo de require com
// painelJogadores.js, que importa este módulo pelos botões.
function resetarPainelFixo(client) {
  const { agendarAtualizacaoReativa } = require('./painelJogadores');
  agendarAtualizacaoReativa(client);
}

// `semContextoGlobal` corta os números fixos do painel (sócios, pico
// histórico do webhook, bonde mensal manual) — eles já aparecem na mensagem
// principal do painel, e misturados aqui na consulta por período só faziam
// parecer que aquele número específico tinha relação com o período filtrado
// (não tem: são todos acumulados/atuais, não recortados pela janela
// escolhida). Sem isso, `linhasContexto` (relatorios.js) some sozinho por
// falta de dado — essa flag só evita o cálculo (pico histórico + sócios) à
// toa.
async function abrirPresenca(interaction, periodo) {
  limparExpiradas();
  const dados = await relatorios.montarDadosPresenca(periodo, { semContextoGlobal: true });
  const consultaId = crypto.randomBytes(6).toString('hex');
  const consulta = { ...dados, userId: interaction.user.id, criadoEm: Date.now() };
  consultas.set(consultaId, consulta);
  await interaction.editReply(renderizarPagina(consultaId, consulta, 0));
}

registrarModulo('presenca', async interaction => {
  const [, acao, a, b] = interaction.customId.split(':');

  if (interaction.isStringSelectMenu() && acao === 'selperiodo') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    await abrirPresenca(interaction, E.resolverPeriodo(interaction.values[0]));
    // O select de período e o de buscar jogador vivem no mesmo painel fixo,
    // mas são buscas avulsas — sem isso, o Discord deixa a opção escolhida
    // "presa" no componente pra sempre (até o próximo ciclo/evento
    // atualizar o painel), parecendo que os dois selects estão combinados.
    resetarPainelFixo(interaction.client);
    return;
  }

  if (interaction.isUserSelectMenu() && acao === 'buscarjogador') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const membro = interaction.members.first();
    const idFivem = E.idFivemDoNick(membro?.nickname ?? membro?.displayName);
    if (!idFivem) {
      resetarPainelFixo(interaction.client);
      return interaction.reply({
        content: `❌ ${membro ?? 'ESSE MEMBRO'} NÃO TEM ID DO JOGO NO APELIDO (PADRÃO "... - 1234").`,
        flags: 64,
        allowedMentions: { parse: [] },
      });
    }
    await interaction.deferReply({ flags: 64 });
    const ficha = await relatorios.montarFichaCompletaJogador(idFivem);
    await interaction.editReply({ embeds: [embedFichaCompleta(membro, ficha)] });
    resetarPainelFixo(interaction.client);
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

  if (interaction.isButton() && acao === 'buscar') {
    const consulta = consultas.get(a);
    if (!consulta || Date.now() - consulta.criadoEm > TTL_MS) {
      return interaction.reply({ content: '⌛ ESTA CONSULTA EXPIROU. CLIQUE NO PERÍODO DE NOVO.', flags: 64 });
    }
    if (consulta.userId !== interaction.user.id) {
      return interaction.reply({ content: '❌ ESSA CONSULTA NÃO É SUA.', flags: 64 });
    }
    return interaction.showModal(modalBuscarJogador(a));
  }

  if (interaction.isModalSubmit() && acao === 'buscarmodal') {
    const consulta = consultas.get(a);
    if (!consulta || Date.now() - consulta.criadoEm > TTL_MS) {
      return interaction.reply({ content: '⌛ ESTA CONSULTA EXPIROU. CLIQUE NO PERÍODO DE NOVO.', flags: 64 });
    }
    if (consulta.userId !== interaction.user.id) {
      return interaction.reply({ content: '❌ ESSA CONSULTA NÃO É SUA.', flags: 64 });
    }
    const termo = interaction.fields.getTextInputValue('termo');
    const encontradas = buscarEntradas(consulta, termo);
    if (!encontradas.length) {
      return interaction.reply({ content: `❌ NENHUM JOGADOR ENCONTRADO PARA \`${termo}\`.`, flags: 64 });
    }
    const placeholder = encontradas.length > 25
      ? `RESULTADO DA BUSCA (${encontradas.length}, MOSTRANDO 25) — ESCOLHA O JOGADOR`
      : `RESULTADO DA BUSCA (${encontradas.length}) — ESCOLHA O JOGADOR`;
    const selectRow = selectDeEntradas(a, encontradas, consulta.ehAgora, placeholder);
    return interaction.reply({ content: `🔎 BUSCA POR \`${termo}\`:`, components: [selectRow], flags: 64 });
  }

  if (interaction.isUserSelectMenu() && acao === 'selusuario') {
    const consulta = consultas.get(a);
    if (!consulta || Date.now() - consulta.criadoEm > TTL_MS) {
      return interaction.reply({ content: '⌛ ESTA CONSULTA EXPIROU. CLIQUE NO PERÍODO DE NOVO.', flags: 64 });
    }
    if (consulta.userId !== interaction.user.id) {
      return interaction.reply({ content: '❌ ESSA CONSULTA NÃO É SUA.', flags: 64 });
    }
    const membro = interaction.members.first();
    const idFivem = E.idFivemDoNick(membro?.nickname ?? membro?.displayName);
    const entrada = idFivem ? consulta.entradas.find(e => e.id === idFivem) : null;
    if (!entrada) {
      return interaction.reply({
        content: `❌ ${membro ?? 'ESSE MEMBRO'} NÃO ESTÁ NESTA CONSULTA (OU NÃO TEM ID DO JOGO NO APELIDO). USE O 🔎 BUSCAR PRA PROCURAR POR NOME OU ID.`,
        flags: 64,
        allowedMentions: { parse: [] },
      });
    }
    return interaction.reply({ embeds: [embedFichaJogador(consulta, entrada)], flags: 64, allowedMentions: { parse: [] } });
  }

  // "sel" continua tratado aqui só pelo resultado da busca por nome/ID
  // (modal), que ainda usa StringSelect — ver selectDeEntradas.
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

  if (interaction.isButton() && acao === 'vincularid') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    return interaction.reply({ components: [selectVincularIdUsuario()], flags: 64 });
  }

  if (interaction.isUserSelectMenu() && acao === 'vincularidusuario') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const membro = interaction.members.first();
    if (!membro) return interaction.reply({ content: '❌ MEMBRO NÃO ENCONTRADO.', flags: 64 });
    const idAtual = E.idFivemDoNick(membro.nickname ?? membro.displayName);
    return interaction.showModal(modalVincularId(membro.id, idAtual));
  }

  if (interaction.isModalSubmit() && acao === 'vincularidmodal') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const idInformado = interaction.fields.getTextInputValue('id').trim();
    if (!/^\d{1,8}$/.test(idInformado)) {
      return interaction.reply({ content: '❌ O ID FIVEM DEVE CONTER APENAS NÚMEROS.', flags: 64 });
    }
    const membro = await interaction.guild.members.fetch(a).catch(() => null);
    if (!membro) return interaction.reply({ content: '❌ ESSE MEMBRO NÃO ESTÁ MAIS NO SERVIDOR.', flags: 64 });

    const nickAtual = membro.nickname ?? membro.displayName;
    const idAtual = E.idFivemDoNick(nickAtual);
    const novoNick = aplicarIdNoNick(nickAtual, idInformado);
    try {
      await membro.setNickname(novoNick);
    } catch (err) {
      return interaction.reply({
        content: `❌ NÃO FOI POSSÍVEL ALTERAR O APELIDO DE ${membro} (SEM PERMISSÃO OU CARGO ACIMA DO BOT).\n\nERRO TÉCNICO: ${err.message}`,
        flags: 64,
        allowedMentions: { parse: [] },
      });
    }
    const acaoTexto = idAtual ? `ID ALTERADO DE \`${idAtual}\` PARA \`${idInformado}\`` : `ID \`${idInformado}\` VINCULADO`;
    // Só soma no placar de incentivo (🆔・socio-sem-id) em vínculo NOVO — quem
    // já tinha ID e só trocou não estava na lista de pendentes, então não é
    // o que o aviso está pedindo pra resolver.
    if (!idAtual) incrementarContadorVinculados(interaction.client).catch(err => console.error('[socios-sem-id] Erro ao somar placar:', err));
    return interaction.reply({
      content: `${acaoTexto} EM ${membro} — NOVO APELIDO: \`${novoNick}\``,
      flags: 64,
      allowedMentions: { parse: [] },
    });
  }

  if (interaction.isButton() && acao === 'editar') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    return interaction.reply({ components: [selectCampoManual()], flags: 64 });
  }

  if (interaction.isButton() && acao === 'ranking') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    return interaction.reply({ components: [selectPeriodoRanking()], flags: 64 });
  }

  if (interaction.isStringSelectMenu() && acao === 'selrankingperiodo') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    const dados = await relatorios.montarDadosPresenca(E.resolverPeriodo(interaction.values[0]), { semContextoGlobal: true });
    await interaction.editReply({ embeds: [embedRanking(dados)], allowedMentions: { parse: [] } });
    return;
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

    // Grava só a chave deste campo (gravarCampoManual, atômico) — não lê o
    // objeto `manual` inteiro pra devolver, então não corre o risco de
    // sobrescrever um incremento automático (SÓCIOS SETADOS somando por
    // recrutamento, ver incrementarSociosManual) que tenha acontecido entre
    // o clique em EDITAR e o envio deste modal.
    await gravarCampoManual(campo.chave, lido.valor == null ? null : {
      valor: lido.valor,
      atualizadoPor: interaction.user.id,
      atualizadoEm: new Date().toISOString(),
    });
    await interaction.reply({ content: `**${campo.rotuloCampo}** atualizado.`, flags: 64 });
    // Requerido aqui dentro (não no topo do arquivo) pra evitar ciclo de
    // require com painelJogadores.js, que importa este módulo pelos botões.
    const { atualizarPainelJogadores } = require('./painelJogadores');
    await atualizarPainelJogadores(interaction.client);
  }
});

module.exports = { linhaBotoesPresenca, abrirPresenca, CONFIG_KEY_MANUAL, incrementarSociosManual };
