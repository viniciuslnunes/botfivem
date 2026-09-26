const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const tema = require('../../tema');
const { nomeSeguro } = require('../logsJogo/painelFormato');

// Só apresentação do sorteio: embed vivo (canal de sorteios), registro do
// histórico, lista de participantes, auditoria e painel fixo. Cor e emoji de
// estado vêm do tema.

const POR_PAGINA = 25;
const dataBR = dia => (dia ? dia.split('-').reverse().join('/') : null);
const unix = d => Math.floor(new Date(d).getTime() / 1000);

function quem(participante, numero) {
  if (!participante) return `**Nº ${numero}**`;
  const marca = participante.discord_id ? ` <@${participante.discord_id}>` : '';
  return `**Nº ${numero}** · **${nomeSeguro(participante.nome)}** \`${participante.id_jogo}\`${marca}`;
}

function linhaEntrega(premio) {
  if (premio.entregue_em) return `\n📦 entregue por <@${premio.entregue_por}> em <t:${unix(premio.entregue_em)}:d>`;
  return `\n${tema.emoji.pendente} a entregar`;
}

function linhasPremios(sorteio, premios, porNumero) {
  if (!premios.length) return ['*Nenhum prêmio ainda. Use ➕ PRÊMIOS.*'];
  const concluido = sorteio.status === 'CONCLUIDO';
  return premios.map(p => `**${p.ordem}. ${p.descricao}**\n${p.numero == null
    ? `${tema.emoji.pendente} a sortear`
    : `🎯 ${quem(porNumero.get(p.numero), p.numero)}`}${concluido && p.numero != null ? linhaEntrega(p) : ''}`);
}

function descricaoOrigem(sorteio, totalParticipantes) {
  if (sorteio.origem !== 'REGISTRO') return `Números de **1 a ${sorteio.total_numeros}**, sem repetir.`;
  const regras = [];
  if (sorteio.min_minutos) regras.push(`mínimo de **${sorteio.min_minutos} min** online`);
  if (sorteio.excluir_dias) regras.push(`sem ganhadores dos últimos **${sorteio.excluir_dias} dias**`);
  const fora = [];
  if (sorteio.excluidos_minimo) fora.push(`${sorteio.excluidos_minimo} abaixo do mínimo`);
  if (sorteio.excluidos_recentes) fora.push(`${sorteio.excluidos_recentes} ganhador(es) recente(s)`);
  return `Jogadores que colaram em **${dataBR(sorteio.dia)}** (registro diário): **${totalParticipantes}** distintos, numerados de 1 a ${sorteio.total_numeros}.`
    + (regras.length ? `\nRegras: ${regras.join(' · ')}.` : '')
    + (fora.length ? `\nFora da lista: ${fora.join(', ')}.` : '');
}

const ESTADO = {
  ABERTO: 'EM ANDAMENTO',
  CONCLUIDO: 'CONCLUÍDO',
  CANCELADO: 'CANCELADO',
};

function embedSorteio(sorteio, premios, participantes) {
  const porNumero = new Map(participantes.map(p => [p.numero, p]));
  const sorteados = premios.filter(p => p.numero != null).length;
  const semNumeros = premios.length > sorteio.total_numeros;
  const linhas = [
    descricaoOrigem(sorteio, participantes.length),
    '',
    ...linhasPremios(sorteio, premios, porNumero).flatMap(l => [l, '']),
  ];
  if (semNumeros) linhas.push(`${tema.emoji.aviso} Há mais prêmios (${premios.length}) do que números (${sorteio.total_numeros}): remova prêmios.`);
  const selo = sorteio.lista_hash ? ` · selo da lista ${sorteio.lista_hash.slice(0, 10)}` : '';
  return {
    color: sorteio.status === 'CANCELADO' ? tema.cor.neutro : tema.cor.primaria,
    title: tema.tituloSegmentado(`🎁 SORTEIO #${sorteio.id} — ${sorteio.titulo}`),
    description: linhas.join('\n').slice(0, 4000),
    footer: { text: `${ESTADO[sorteio.status]} · ${sorteados}/${premios.length} sorteados${selo}` },
  };
}

function botoesSorteio(sorteio, premios) {
  const id = sorteio.id;
  const btn = (acao, rotulo, emoji, estilo = ButtonStyle.Secondary) => new ButtonBuilder()
    .setCustomId(`sorteio:${acao}:${id}`).setLabel(rotulo).setEmoji(emoji).setStyle(estilo);
  const pendentes = premios.filter(p => p.numero == null).length;
  const sorteados = premios.length - pendentes;
  const daRegistro = sorteio.origem === 'REGISTRO';
  return [
    new ActionRowBuilder().addComponents(
      btn('proximo', 'SORTEAR PRÓXIMO', '🎲').setDisabled(!pendentes),
      btn('todos', 'SORTEAR TODOS', '🎰').setDisabled(!pendentes),
      btn('lista', 'PARTICIPANTES', '👥'),
      btn('auditoria', 'AUDITORIA', '🧾')
    ),
    new ActionRowBuilder().addComponents(
      btn('premio_add', 'PRÊMIOS', '➕'),
      btn('premio_edit', 'EDITAR', '✏️').setDisabled(!pendentes),
      btn('premio_del', 'REMOVER', '🗑️').setDisabled(!pendentes),
      btn('ressortear', 'RESSORTEAR', '🔁').setDisabled(!sorteados)
    ),
    new ActionRowBuilder().addComponents(
      ...(daRegistro ? [
        btn('atualizar', 'ATUALIZAR LISTA', '🔄').setDisabled(sorteados > 0),
        btn('recentes', sorteio.excluir_dias ? 'LIBERAR RECENTES' : 'EXCLUIR RECENTES', '⚖️').setDisabled(sorteados > 0),
      ] : []),
      btn('concluir', 'CONCLUIR', tema.emoji.ok).setDisabled(!premios.length || pendentes > 0),
      btn('cancelar', 'CANCELAR', tema.emoji.recusado, ButtonStyle.Danger)
    ),
  ];
}

function botaoEntrega(sorteio, premios) {
  if (sorteio.status !== 'CONCLUIDO' || !premios.some(p => p.numero != null && !p.entregue_em)) return [];
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sorteio:entrega:${sorteio.id}`).setLabel('MARCAR ENTREGA').setEmoji('📦').setStyle(ButtonStyle.Secondary)
  )];
}

function montarSorteio(sorteio, premios, participantes) {
  return {
    embeds: [embedSorteio(sorteio, premios, participantes)],
    components: sorteio.status === 'ABERTO' ? botoesSorteio(sorteio, premios) : [],
    allowedMentions: { parse: [] },
  };
}

// Registro que vai para o canal de histórico; com prêmio por entregar leva o botão de entrega
function montarHistorico(sorteio, premios, participantes) {
  const base = embedSorteio(sorteio, premios, participantes);
  const pendentes = premios.filter(p => p.numero != null && !p.entregue_em).length;
  return {
    embeds: [{
      ...base,
      title: tema.tituloSegmentado(`📜 SORTEIO #${sorteio.id} — ${sorteio.titulo}`),
      footer: { text: `${ESTADO[sorteio.status]} · ${pendentes ? `${pendentes} prêmio(s) por entregar` : 'todos os prêmios entregues'}${sorteio.lista_hash ? ` · selo da lista ${sorteio.lista_hash.slice(0, 10)}` : ''}` },
      timestamp: new Date().toISOString(),
    }],
    components: botaoEntrega(sorteio, premios),
    allowedMentions: { parse: [] },
  };
}

// Aviso público de quem ganhou (marca só quem tem Discord ligado)
function montarAnuncio(sorteio, premios, participantes) {
  const porNumero = new Map(participantes.map(p => [p.numero, p]));
  const usuarios = [...new Set(premios.map(p => porNumero.get(p.numero)?.discord_id).filter(Boolean))];
  const linhas = premios.map(p => `🎁 **${p.descricao}** → ${quem(porNumero.get(p.numero), p.numero)}`);
  return {
    content: `🎉 **RESULTADO DO SORTEIO #${sorteio.id} — ${sorteio.titulo}**\n${linhas.join('\n')}`.slice(0, 2000),
    allowedMentions: { users: usuarios },
  };
}

function montarLista(sorteio, participantes, pagina) {
  const totalPaginas = Math.max(1, Math.ceil(participantes.length / POR_PAGINA));
  const atual = Math.min(Math.max(0, pagina), totalPaginas - 1);
  const fatia = participantes.slice(atual * POR_PAGINA, (atual + 1) * POR_PAGINA);
  const embed = {
    color: tema.cor.primaria,
    title: tema.tituloSegmentado(`👥 SORTEIO #${sorteio.id} — PARTICIPANTES`),
    description: fatia.map(p => `**${p.numero}.** **${nomeSeguro(p.nome)}** \`${p.id_jogo}\``).join('\n') || '*Sem lista de jogadores: o sorteio é só entre números.*',
    footer: { text: `Página ${atual + 1}/${totalPaginas} · ${participantes.length} participantes` },
  };
  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sorteio:pag:${sorteio.id}:${atual - 1}`).setLabel('ANTERIOR').setStyle(ButtonStyle.Secondary).setDisabled(atual === 0),
    new ButtonBuilder().setCustomId(`sorteio:pag:${sorteio.id}:${atual + 1}`).setLabel('PRÓXIMA').setStyle(ButtonStyle.Secondary).setDisabled(atual >= totalPaginas - 1)
  );
  return { embeds: [embed], components: totalPaginas > 1 ? [nav] : [], allowedMentions: { parse: [] } };
}

// Trilha de auditoria: tudo que qualquer pessoa precisa para conferir que o sorteio foi limpo
function montarAuditoria(sorteio, premios, participantes, sorteadas) {
  const desc = new Map(premios.map(p => [String(p.premio_id ?? p.id), p.descricao]));
  const porNumero = new Map(participantes.map(p => [p.numero, p]));
  const linhas = sorteadas.map((s, i) => {
    const p = porNumero.get(s.numero);
    const nome = p ? ` ${nomeSeguro(p.nome)}` : '';
    return `**${i + 1}.** ${s.tipo === 'RESSORTEIO' ? '🔁 ressorteio' : '🎲 sorteio'} · ${desc.get(String(s.premio_id)) ?? 'prêmio removido'} → **Nº ${s.numero}**${nome}\n`
      + `<t:${unix(s.em)}:f> por <@${s.por}> · restavam ${s.restantes} número(s)`;
  });
  return {
    embeds: [{
      color: tema.cor.primaria,
      title: tema.tituloSegmentado(`🧾 AUDITORIA — SORTEIO #${sorteio.id}`),
      description: [
        `Criado por <@${sorteio.criado_por}> em <t:${unix(sorteio.criado_em)}:f>.`,
        sorteio.lista_hash ? `Selo da lista (SHA-256): \`${sorteio.lista_hash}\`` : 'Sorteio só de números (sem lista de jogadores).',
        `Intervalo: **1 a ${sorteio.total_numeros}** · sorteio por \`crypto.randomInt\`, número nunca repete.`,
        '',
        linhas.join('\n\n') || '*Nenhum número sorteado ainda.*',
      ].join('\n').slice(0, 4000),
    }],
    allowedMentions: { parse: [] },
  };
}

// Select de prêmios (editar/remover: pendentes; ressortear: já sorteados; entrega: sorteados sem entrega)
function montarSelectPremios(acao, sorteio, premios, placeholder, { sorteados = false, participantes = [] } = {}) {
  const porNumero = new Map(participantes.map(p => [p.numero, p]));
  const opcoes = premios.filter(p => (p.numero != null) === sorteados).slice(0, 25).map(p => ({
    label: `${p.ordem}. ${p.descricao}${sorteados ? ` → Nº ${p.numero}${porNumero.get(p.numero) ? ` ${porNumero.get(p.numero).nome}` : ''}` : ''}`.slice(0, 100),
    value: String(p.id),
  }));
  return {
    content: placeholder,
    components: [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`sorteio:${acao}:${sorteio.id}`).setPlaceholder('Escolha o prêmio').addOptions(opcoes)
    )],
    flags: 64,
  };
}

function montarPainel() {
  return {
    embeds: [{
      color: tema.cor.primaria,
      title: tema.tituloSegmentado('🎁 SORTEIOS'),
      description: 'Sorteio dos brindes de quem colou no dia: **pistas, veículos, armas, dinheiro**, o que a liderança definir.\n\n'
        + '• A lista sai do **registro diário** (jogadores distintos, numerados) ou de um intervalo de números.\n'
        + '• Cada número sai **uma vez só**: ninguém ganha duas vezes. A **auditoria** mostra cada saída.\n'
        + '• Dá para exigir **tempo mínimo online** e **dar chance a quem não ganhou há pouco**.\n'
        + '• Ganhador ausente? **Ressortear** dá outro número ao prêmio. Ao concluir, os ganhadores são avisados e o sorteio vai para o **histórico**, onde a **entrega** é marcada.\n\n'
        + '_Só a presidência e o gestor de Social e Eventos criam e conduzem._',
    }],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('sorteio:novo').setLabel('NOVO SORTEIO').setEmoji('🎁').setStyle(ButtonStyle.Secondary)
    )],
  };
}

module.exports = {
  POR_PAGINA, montarSorteio, montarHistorico, montarAnuncio, montarLista, montarAuditoria, montarSelectPremios, montarPainel, embedSorteio, quem,
};
