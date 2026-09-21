const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { registrarModulo } = require('../modulos');
const { ehLideranca, MSG_SO_LIDERANCA } = require('../permissoes');
const { lerConfig } = require('../botConfig');
const db = require('../db');
const E = require('./estatisticas');
const F = require('./painelFormato');
const repo = require('./repositorio');
const { selectPeriodo, selectBuscarJogador, linhaBotao } = require('./painelComponentesFixos');

// Canal 🏦・caixa-do-jogo: mesmo padrão interativo do 📦・estoque-bau (ver
// docs/inteligencia-logs-jogo.md § "Padrão de UI"). Aqui não existe uma LISTA
// pra paginar — é dinheiro e honra agregados —, então o select de período abre
// direto o resumo do período (dois embeds: dinheiro e honra), sem paginação.
const MODULO = 'caixa';

// Saldo real da torcida (batido à mão pela liderança a partir do painel do
// próprio jogo, ver imagem no pedido de 2026-09-14) — diverge do "Líquido"
// calculado a partir dos logs porque o jogo só publica entrada/saída, não o
// saldo da conta, e o webhook perde mensagem de vez em quando (mesmo motivo
// de "SÓCIOS SETADOS" em painel_jogadores_manual). Mesmo padrão "botão
// EDITAR → select → modal de um campo só" de presencaInteracoes.js
// (CAMPOS_MANUAIS) — ver docs/plano-modulos-torcida.md § "Edição de dado
// manual num painel fixo". Diferença: aqui o valor também reage sozinho a
// cada depósito/saque novo do webhook (incrementarSaldoCaixaManual, chamado
// por events/messageCreate.js), pra não precisar bater de novo no jogo toda
// hora — só a divergência acumulada por perda de webhook precisa de ajuste
// manual de vez em quando.
const CONFIG_KEY_MANUAL = 'painel_caixa_manual';

const CAMPOS_MANUAIS = [
  {
    chave: 'saldo', rotuloSelect: 'Saldo no banco da torcida', rotuloCampo: 'SALDO NO BANCO DA TORCIDA',
    descricaoSelect: 'Some/diminui sozinho a cada depósito ou saque do webhook — editar aqui só ajusta por cima',
  },
];

// Moedas que nunca se somam (ver painelCaixa.js) — únicas o bastante pra
// ficarem aqui, fonte de verdade pras duas telas (resumo fixo e interativo).
const DINHEIRO_ENTRA = ['banco_depositou', 'dinheiro_conquista', 'dinheiro_adicionado'];
const DINHEIRO_SAI = ['banco_sacou'];
const DINHEIRO = [...DINHEIRO_ENTRA, ...DINHEIRO_SAI];
const HONRA = ['honra_adicionada', 'honra_gastou'];
const ROUPA = ['comprou_roupa'];
const ACOES_TODAS = [...DINHEIRO, ...HONRA, ...ROUPA];

// Delta de dinheiro (entrou - saiu) de um lote de registros novos do
// webhook — chamado por events/messageCreate.js a cada log gravado, pra
// somar em cima do saldo batido à mão (ver incrementarSaldoCaixaManual mais
// abaixo). `valor` nos registros já vem sempre positivo (Math.abs no
// parser); a direção é só o `acao`.
function deltaCaixa(registros) {
  return registros.reduce((total, r) => {
    if (DINHEIRO_ENTRA.includes(r.acao)) return total + Number(r.valor ?? 0);
    if (DINHEIRO_SAI.includes(r.acao)) return total - Number(r.valor ?? 0);
    return total;
  }, 0);
}

const ROTULOS = {
  banco_depositou: 'Depósitos de sócios',
  dinheiro_conquista: 'Prêmio de conquista de território',
  dinheiro_adicionado: 'Dinheiro posto pela staff',
  banco_sacou: 'Saques',
  honra_adicionada: '🎖️ Honra recebida',
  honra_gastou: '🎖️ Honra gasta',
  comprou_roupa: 'Roupa (R$ do bolso do sócio)',
};

async function lerManualCaixa() {
  try {
    const bruto = await lerConfig(CONFIG_KEY_MANUAL);
    return bruto ? JSON.parse(bruto) : {};
  } catch {
    return {};
  }
}

// Grava só a chave deste campo (jsonb_set atômico, mesmo motivo de
// gravarCampoManual em presencaInteracoes.js) sem tocar no resto do objeto —
// não corre o risco de pisar num incremento automático (depósito/saque
// chegando pelo webhook nesse meio-tempo).
async function gravarCampoManualCaixa(chave, valorObj) {
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

// Chamado por events/messageCreate.js a cada depósito/saque novo que o
// webhook loga (delta = entrou - saiu daquele lote). Só ajusta se já existe
// um saldo batido à mão — sem baseline setada pela liderança (botão EDITAR),
// não tem o que corrigir, e criar um "saldo" do nada a partir de um delta
// parcial ia só duplicar o "Líquido" já mostrado, com outro nome. Preserva
// quem/quando da última edição manual — só o valor muda. UPDATE atômico
// (mesmo motivo do jsonb_set acima): várias mensagens de log podem chegar em
// rajada, cada uma virando uma chamada concorrente daqui.
async function incrementarSaldoCaixaManual(delta) {
  if (!delta) return;
  await db.query(
    `UPDATE bot_config SET value = jsonb_set(
       value::jsonb, '{saldo,valor}',
       to_jsonb(((value::jsonb->'saldo'->>'valor')::numeric + $1::numeric))
     )::text
     WHERE key = $2 AND value::jsonb->'saldo'->>'valor' IS NOT NULL`,
    [delta, CONFIG_KEY_MANUAL]
  );
}

// Aceita "16.203.033", "16203033", "16.203.033,50" ou "16203033.5"; vazio
// vira null (remove o valor manual). Mesma tolerância de formato do parser
// dos logs do jogo (ver parser.js#normalizarNumero) — só que aqui é o que a
// liderança digita à mão, não o que o jogo manda.
function lerDinheiroOuNulo(texto) {
  const bruto = texto.trim().replace(/R\$|\$/gi, '').replace(/\s/g, '');
  if (!bruto) return { valor: null };
  let s = bruto;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{3}(\.|$)/.test(s)) s = s.replace(/\./g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return { erro: true };
  const n = Number(s);
  return Number.isFinite(n) ? { valor: n } : { erro: true };
}

function somaDe(linhas, acoes) {
  return linhas.filter(l => acoes.includes(l.acao)).reduce((t, l) => t + Number(l.soma), 0);
}

function totalDe(linhas, acoes) {
  return linhas.filter(l => acoes.includes(l.acao)).reduce((t, l) => t + Number(l.total), 0);
}

function moeda(acao, valor) {
  return HONRA.includes(acao) ? `${E.formatarNumero(valor)} de honra` : E.formatarDinheiro(valor);
}

function linhaResumo(l) {
  return `**${ROTULOS[l.acao] ?? l.acao}** — ${moeda(l.acao, l.soma)} em ${E.formatarNumero(l.total)} ${l.total === 1 ? 'registro' : 'registros'}`;
}

function linhaPessoaValor(l, i) {
  return `${i + 1}. ${F.pessoa(l)} — ${E.formatarDinheiro(l.soma)} (${E.formatarNumero(l.total)}×)`;
}

function linhaMovimento(l) {
  const quando = E.formatarDataHora(l.ocorrido_em);
  if (l.acao === 'dinheiro_conquista') return `Conquista de **${F.nomeSeguro(l.alvo_nome)}** rendeu **${E.formatarDinheiro(l.valor)}** — ${quando}`;
  const quem = F.pessoa({ nome: l.ator_nome, id: l.ator_id_fivem });
  if (l.acao === 'dinheiro_adicionado') return `Staff ${quem} pôs **${E.formatarDinheiro(l.valor)}** — ${quando}`;
  if (l.acao.startsWith('honra')) return `🎖️ ${quem} ${l.acao === 'honra_gastou' ? `gastou **${E.formatarNumero(l.valor)}** em ${F.nomeSeguro(l.alvo_nome ?? 'item')}` : `recebeu **${E.formatarNumero(l.valor)}**`} — ${quando}`;
  if (l.acao === 'comprou_roupa') return `${quem} gastou **${E.formatarDinheiro(l.valor)}** em roupa — ${quando}`;
  const entrou = l.acao === 'banco_depositou';
  return `${quem} ${entrou ? 'depositou' : 'sacou'} **${E.formatarDinheiro(l.valor)}** — ${quando}`;
}

function cabecalhoDinheiro(somas, rotulo, aviso, saldoManual) {
  const entrou = somaDe(somas, DINHEIRO_ENTRA);
  const saiu = somaDe(somas, DINHEIRO_SAI);
  const liquido = entrou - saiu;
  return [
    ...(aviso ? [aviso, ''] : []),
    `**${rotulo}**`,
    `Entrou: **${E.formatarDinheiro(entrou)}** (${E.formatarNumero(totalDe(somas, DINHEIRO_ENTRA))} registros)`,
    `Saiu: **${E.formatarDinheiro(saiu)}** (${E.formatarNumero(totalDe(somas, DINHEIRO_SAI))} saques)`,
    `Líquido: **${E.formatarDinheiro(liquido)}**`,
    // Número real do painel do jogo, batido à mão (botão EDITAR) — ver
    // CAMPOS_MANUAIS acima. Só aparece se a liderança já setou algum valor.
    ...(saldoManual?.valor != null ? [`**SALDO NO BANCO DA TORCIDA:** ${E.formatarDinheiro(saldoManual.valor)}`] : []),
    '',
    '*Movimento do período, não o saldo da conta — o jogo só publica entrada e saída.*',
  ].join('\n');
}

async function dadosDoPeriodo(periodo) {
  const [somas, topDeposito, topSaque, movimentos, honraGasta, ultima, manual] = await Promise.all([
    repo.somarPorAcoes(ACOES_TODAS, periodo),
    repo.topAtoresPorValor(['banco_depositou'], periodo, 10).then(F.comNomes),
    repo.topAtoresPorValor(DINHEIRO_SAI, periodo, 10).then(F.comNomes),
    repo.listarPorAcoes(DINHEIRO, periodo, 10).then(l => F.comNomes(l, { id: 'ator_id_fivem', nome: 'ator_nome' })),
    repo.listarPorAcoes(['honra_gastou'], periodo, 10).then(l => F.comNomes(l, { id: 'ator_id_fivem', nome: 'ator_nome' })),
    repo.ultimaOcorrencia(DINHEIRO),
    lerManualCaixa(),
  ]);
  return { somas, topDeposito, topSaque, movimentos, honraGasta, ultima, manual };
}

function embedDinheiro(periodo, d) {
  const doDinheiro = d.somas.filter(l => DINHEIRO.includes(l.acao));
  const fields = [
    ...F.campoLista('MOVIMENTO POR TIPO', doDinheiro.map(linhaResumo), 'Sem movimento.'),
    ...(d.movimentos.length ? [{ name: 'ÚLTIMAS MOVIMENTAÇÕES', value: E.truncar(d.movimentos.map(linhaMovimento).join('\n'), 1024) }] : []),
    ...(d.topSaque.length ? [{ name: 'QUEM SACOU', value: E.truncar(d.topSaque.map(linhaPessoaValor).join('\n'), 1024) }] : []),
    ...(d.topDeposito.length ? [{ name: 'QUEM MAIS DEPOSITOU', value: E.truncar(d.topDeposito.map(linhaPessoaValor).join('\n'), 1024) }] : []),
  ];
  return {
    color: F.COR,
    title: `🏦 BANCO DA TORCIDA — ${periodo.rotulo}`,
    description: cabecalhoDinheiro(d.somas, periodo.rotulo, F.avisoFonteParada(d.ultima), d.manual?.saldo),
    fields,
    footer: { text: F.rodape('canal logs-banco') },
  };
}

function embedHonraGasto(periodo, d) {
  const recebida = somaDe(d.somas, ['honra_adicionada']);
  const gasta = somaDe(d.somas, ['honra_gastou']);
  const linhas = d.honraGasta.map(l => `• ${F.pessoa({ nome: l.ator_nome, id: l.ator_id_fivem })} gastou **${E.formatarNumero(l.valor)}** em **${F.nomeSeguro(l.alvo_nome ?? 'item')}** — ${E.formatarDataHora(l.ocorrido_em)}`);
  return {
    color: F.COR,
    title: `🎖️ HONRA — ${periodo.rotulo}`,
    description: `Recebida: **${E.formatarNumero(recebida)}** · Gasta: **${E.formatarNumero(gasta)}**\n*Honra é moeda própria: não se soma com dinheiro.*`,
    fields: F.campoLista('ÚLTIMOS GASTOS', linhas, 'Ninguém gastou honra no período.'),
    footer: { text: F.rodape('canal logs-banco') },
  };
}

async function abrirCaixa(interaction, periodo) {
  const dados = await dadosDoPeriodo(periodo);
  await interaction.editReply({ embeds: [embedDinheiro(periodo, dados), embedHonraGasto(periodo, dados)] });
}

// ── Ranking ──────────────────────────────────────────────────────────────────

function linhaRankingValor(l, i) {
  return `${i + 1}. ${F.pessoa(l)} — ${E.formatarDinheiro(l.soma)} (${E.formatarNumero(l.total)}×)`;
}

async function embedRanking(periodo) {
  const [topDeposito, topSaque, topHonra] = await Promise.all([
    repo.topAtoresPorValor(['banco_depositou'], periodo, 10).then(F.comNomes),
    repo.topAtoresPorValor(DINHEIRO_SAI, periodo, 10).then(F.comNomes),
    repo.topAtoresPorValor(['honra_gastou'], periodo, 10).then(F.comNomes),
  ]);
  return {
    color: F.COR,
    title: `🏆 RANKING DO CAIXA — ${periodo.rotulo}`,
    fields: [
      { name: 'QUEM MAIS DEPOSITOU', value: topDeposito.map(linhaRankingValor).join('\n') || '*Sem dados.*' },
      { name: 'QUEM MAIS SACOU', value: topSaque.map(linhaRankingValor).join('\n') || '*Sem dados.*' },
      { name: '🎖️ QUEM MAIS GASTOU HONRA', value: topHonra.map(linhaRankingValor).join('\n') || '*Sem dados.*' },
    ],
    footer: { text: F.rodape('canal logs-banco') },
    timestamp: new Date().toISOString(),
  };
}

// ── Ficha de jogador ─────────────────────────────────────────────────────────

async function embedFichaJogador(idFivem, nomeConhecido) {
  const eventos = await repo.eventosDoAtor(idFivem, ACOES_TODAS, 8);
  const depositou = await repo.somarPorAcoes(['banco_depositou'], E.resolverPeriodo('tudo'));
  return {
    color: F.COR,
    title: `🏦 ${F.nomeSeguro(nomeConhecido ?? idFivem)} — CAIXA`,
    description: [
      `**ID:** \`${idFivem}\``,
      depositou[0] ? `**Depositado (total):** ${E.formatarDinheiro(depositou[0].soma)} em ${E.formatarNumero(depositou[0].total)}×` : null,
    ].filter(Boolean).join('\n'),
    fields: F.campoLista('ÚLTIMOS MOVIMENTOS', eventos.map(linhaMovimento), 'Nenhum movimento registrado.'),
    footer: { text: F.rodape('canal logs-banco') },
  };
}

// Botão EDITAR (saldo real, batido à mão) ao lado do RANKING — mesma linha
// de botões de presencaInteracoes.js#linhaBotoesAcao.
function linhaBotoesAcao() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${MODULO}:editar`).setLabel('EDITAR').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${MODULO}:ranking`).setLabel('RANKING').setEmoji('🏆').setStyle(ButtonStyle.Secondary)
  );
}

function linhaComponentesCaixa() {
  return [
    selectPeriodo(MODULO),
    selectBuscarJogador(MODULO),
    linhaBotoesAcao(),
  ];
}

// Passo 1 do botão EDITAR (ephemeral, só quem clicou vê): qual campo.
function selectCampoManual() {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${MODULO}:editarcampo`)
    .setPlaceholder('SELECIONE O CAMPO PARA EDITAR')
    .addOptions(CAMPOS_MANUAIS.map(c => ({ label: c.rotuloSelect, value: c.chave, description: c.descricaoSelect })));
  return new ActionRowBuilder().addComponents(select);
}

// Passo 2: modal de um campo só, valor atual já preenchido. Cancelar/Enviar
// são os botões nativos do modal do Discord.
function modalCampoManual(campo, valorAtual) {
  return new ModalBuilder()
    .setCustomId(`${MODULO}:editarmodal:${campo.chave}`)
    .setTitle('CAIXA')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('valor').setLabel(campo.rotuloCampo)
      .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(20)
      .setPlaceholder('Deixe em branco pra remover')
      .setValue(valorAtual != null ? String(valorAtual) : '')));
}

registrarModulo(MODULO, async interaction => {
  const [, acao, a] = interaction.customId.split(':');

  if (interaction.isStringSelectMenu() && acao === 'selperiodo') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    await abrirCaixa(interaction, E.resolverPeriodo(interaction.values[0]));
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

  if (interaction.isButton() && acao === 'ranking') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    return interaction.reply({ components: [selectPeriodo(MODULO, { acao: 'selrankingperiodo', placeholder: 'ESCOLHA UM PERÍODO PARA O RANKING' })], flags: 64 });
  }

  if (interaction.isStringSelectMenu() && acao === 'selrankingperiodo') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    await interaction.deferReply({ flags: 64 });
    await interaction.editReply({ embeds: [await embedRanking(E.resolverPeriodo(interaction.values[0]))] });
    return;
  }

  if (interaction.isButton() && acao === 'editar') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    return interaction.reply({ components: [selectCampoManual()], flags: 64 });
  }

  if (interaction.isStringSelectMenu() && acao === 'editarcampo') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const campo = CAMPOS_MANUAIS.find(c => c.chave === interaction.values[0]);
    if (!campo) return interaction.update({ content: '❌ CAMPO DESCONHECIDO.', components: [] });
    const manual = await lerManualCaixa();
    return interaction.showModal(modalCampoManual(campo, manual[campo.chave]?.valor));
  }

  if (interaction.isModalSubmit() && acao === 'editarmodal') {
    if (!ehLideranca(interaction.member)) return interaction.reply({ content: MSG_SO_LIDERANCA, flags: 64 });
    const campo = CAMPOS_MANUAIS.find(c => c.chave === a);
    if (!campo) return interaction.reply({ content: '❌ CAMPO DESCONHECIDO.', flags: 64 });
    const lido = lerDinheiroOuNulo(interaction.fields.getTextInputValue('valor'));
    if (lido.erro) return interaction.reply({ content: '❌ USE SÓ NÚMEROS (EX.: 16203033 OU 16.203.033,50).', flags: 64 });

    // Grava só a chave deste campo (gravarCampoManualCaixa, atômico) — não lê
    // o objeto `manual` inteiro pra devolver, então não corre o risco de
    // sobrescrever um incremento automático (depósito/saque somando por
    // cima, ver incrementarSaldoCaixaManual) que tenha acontecido entre o
    // clique em EDITAR e o envio deste modal.
    await gravarCampoManualCaixa(campo.chave, lido.valor == null ? null : {
      valor: lido.valor,
      atualizadoPor: interaction.user.id,
      atualizadoEm: new Date().toISOString(),
    });
    await interaction.reply({ content: `**${campo.rotuloCampo}** atualizado.`, flags: 64 });
    // Requerido aqui dentro (não no topo do arquivo) pra evitar ciclo de
    // require com painelCaixa.js, que importa este módulo pelos botões.
    const { atualizarPainelCaixa } = require('./painelCaixa');
    await atualizarPainelCaixa(interaction.client);
  }
});

module.exports = {
  linhaComponentesCaixa, DINHEIRO, HONRA, ROUPA, ACOES_TODAS, cabecalhoDinheiro, linhaResumo, linhaPessoaValor,
  CONFIG_KEY_MANUAL, lerManualCaixa, incrementarSaldoCaixaManual, deltaCaixa, embedFichaJogador,
};
