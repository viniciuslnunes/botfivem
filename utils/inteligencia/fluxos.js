// Fluxos que se conversam: o que acontece num fluxo (ficha decidida, ADV registrada, ticket aberto)
// dispara consequências em outro, em tempo real, pelo barramento (utils/barramento.js). A varredura
// de 3 h continua existindo para o que ninguém anunciou; aqui é o que dá para reagir na hora.
// Só informa e agenda acompanhamento; nada aqui pune nem concede. Assinado por modulos/inteligencia.js.
const config = require('../../config/index.js');
const tema = require('../../tema');
const barramento = require('../barramento');
const enriquecedores = require('../enriquecedores');
const { agendar, registrarTipo } = require('../agendador');
const F = require('../logsJogo/painelFormato');
const E = require('../logsJogo/estatisticas');
const R = require('./regras');
const repo = require('./repositorio');
const { garantirCanalInteligencia } = require('./canais');

const TIPO_ACOMPANHAMENTO = 'inteligencia_acompanhamento';

// Depois de aprovar: 24 h → o jogo já registrou o recrutamento? 72 h → apareceu? 7 dias → continua ativo?
const ETAPAS = Object.freeze({
  setagem: 24 * R.HORA_MS,
  aparecer: 72 * R.HORA_MS,
  semana: 7 * R.DIA_MS,
});

const link = (canalId, messageId) => `https://discord.com/channels/${config.guildId}/${canalId}/${messageId}`;

// ── Ficha decidida → acompanhamento do recém-aprovado ────────────────────────

async function aoFichaDecidida({ status, fichaId }) {
  if (status !== 'APROVADO') return;
  const agora = Date.now();
  for (const [etapa, ms] of Object.entries(ETAPAS)) {
    await agendar(TIPO_ACOMPANHAMENTO, new Date(agora + ms), { fichaId, etapa });
  }
}

const mencionar = id => (id ? { content: `<@${id}>`, allowedMentions: { users: [id] } } : { content: null, allowedMentions: { parse: [] } });

async function avisarAcompanhamento(client, ficha, { etapa, titulo, descricao }) {
  const canal = await garantirCanalInteligencia(client);
  const { content, allowedMentions } = mencionar(ficha.decidido_por_id);
  await require('./casos').enviar(canal, {
    tipo: `acompanhamento_${etapa}`, chave: `${etapa}:${ficha.message_id}`, alvoDiscordId: ficha.discord_id, dados: { fichaId: ficha.message_id },
  }, {
    content: content ?? undefined,
    allowedMentions,
    embeds: [{
      color: tema.cor.aviso,
      title: titulo,
      description: descricao,
      fields: [
        { name: 'CANDIDATO', value: `<@${ficha.discord_id}> (${F.nomeSeguro(ficha.nome ?? '?')})`, inline: true },
        { name: 'ID NO JOGO', value: ficha.id_fivem ?? '?', inline: true },
        { name: 'APROVADO POR', value: ficha.decidido_por_id ? `<@${ficha.decidido_por_id}>` : '?', inline: true },
        { name: 'FICHA', value: `[abrir](${link(config.canais.validarSetagem, ficha.message_id)})` },
      ],
      footer: { text: 'Acompanhamento pós-aprovação · só informa' },
      timestamp: new Date().toISOString(),
    }],
  });
}

// Executada pelo agendador (persistente: sobrevive a reinício). Se a decisão foi desfeita no meio
// do caminho, a ficha já não está APROVADA e nada acontece.
async function acompanhar(client, { fichaId, etapa }) {
  const ficha = await require('../recrutamento/fichas').buscarFicha(fichaId);
  if (!ficha || ficha.status !== 'APROVADO' || !ficha.id_fivem) return 'ignorada';
  const decisao = new Date(ficha.decidido_em ?? ficha.criado_em);

  if (etapa === 'setagem') {
    if (await repo.recrutadoNoJogoDesde(ficha.id_fivem, new Date(ficha.criado_em))) return 'ok';
    await avisarAcompanhamento(client, ficha, {
      etapa: 'setagem',
      titulo: '⏱️ APROVADO NO DISCORD, AINDA NÃO SETADO NO JOGO',
      descricao: 'A ficha foi aprovada há 24 h e o jogo não registrou o recrutamento do ID. Sem a setagem no jogo, a pessoa não entra na torcida de verdade.',
    });
    return 'avisada';
  }
  if (etapa === 'aparecer') {
    if (await repo.entrouNoJogoDesde(ficha.id_fivem, decisao)) return 'ok';
    await avisarAcompanhamento(client, ficha, {
      etapa: 'aparecer',
      titulo: '👻 APROVADO HÁ 3 DIAS E NÃO APARECEU NO JOGO',
      descricao: 'Nenhuma entrada no jogo desde a aprovação. Vale o recrutador chamar a pessoa antes que ela suma.',
    });
    return 'avisada';
  }
  if (etapa === 'semana') {
    if (await repo.entrouNoJogoDesde(ficha.id_fivem, new Date(decisao.getTime() + 4 * R.DIA_MS))) {
      await require('../confianca/servico').registrarSinal(client, {
        discordId: ficha.discord_id, sinal: 'NOVATO_ATIVO', origemTipo: 'ficha', origemId: fichaId,
      });
      return 'ativo';
    }
    await avisarAcompanhamento(client, ficha, {
      etapa: 'semana',
      titulo: '📉 NOVO SÓCIO SEM JOGAR NA PRIMEIRA SEMANA',
      descricao: 'Sete dias depois da aprovação, nenhuma entrada nos últimos 3 dias. É o ponto em que mais gente some.',
    });
    return 'avisada';
  }
  return 'ignorada';
}

// ── ADV registrada/removida → resumo, confiança e reincidência na hora ───────

async function atualizarMembro(client, membro) {
  const resumo = require('./resumo');
  const { idFivemDoNick } = E;
  const socio = { membro, discordId: membro.id, nome: membro.displayName, idFivem: idFivemDoNick(membro.nickname ?? membro.displayName) };
  const [r] = await resumo.atualizarResumos(client, { socios: [socio] });
  return r;
}

async function aoAdvRegistrada({ client, membro, advId }) {
  if (advId) {
    await require('../confianca/servico').registrarSinal(client, {
      discordId: membro.id, sinal: 'ADV_SOCIO', origemTipo: 'adv_socio', origemId: advId,
    });
  }
  const r = await atualizarMembro(client, membro);
  if (!r) return;
  const canal = await client.channels.fetch(config.canais.associadoEmAtencao).catch(() => null) ?? await garantirCanalInteligencia(client);
  await require('./varredura').alertarReincidencia(canal, [r], new Date());
}

async function aoAdvRemovida({ client, membro }) {
  await atualizarMembro(client, membro);
}

// ── Restrição no jogo para quem tem pagamento pendente → caso com botões ─────────────────────────
// O alerta nasce em utils/advertencia/contexto.js; aqui ele vira caso (bloquear ID, remover sócio,
// resolvido, ignorar). Fecha sozinho quando a pendência sai da fila (paga, vencida ou removida).

async function aoRestricaoPendente({ guild, embed, content, membro, idFivem, restricao, advId }) {
  const canal = await guild.channels.fetch(config.canais.advPendentes).catch(() => null);
  if (!canal) return;
  await require('./casos').enviar(canal, {
    tipo: 'restricao_com_pendencia', chave: `${advId}:${restricao}`, alvoDiscordId: membro.id,
    dados: { idFivem, advId: String(advId), restricao },
    acoes: restricao === 'blacklist' ? ['bloquear', 'remover_socio'] : ['remover_socio'],
  }, { content, embeds: [embed] });
}

async function aoPendenciaEncerrada({ client, advId }) {
  const casos = require('./casos');
  for (const caso of await casos.abertos(['restricao_com_pendencia'])) {
    if (String(caso.dados?.advId) !== String(advId)) continue;
    const motivo = 'a pendência de pagamento foi encerrada';
    const fechado = await casos.fechar(caso.id, 'RESOLVIDO', { resolucao: motivo });
    if (fechado) await casos.encerrarMensagem(client, fechado, `✔️ resolvido automaticamente — ${motivo}`);
  }
}

// ── Ticket aberto → contexto do candidato ────────────────────────────────────

async function aoTicketAberto({ canal, categoria, usuario }) {
  if (categoria !== 'recrutamento') return;
  const ficha = await repo.ultimaFichaDoCandidato(usuario.id);
  const seg = data => Math.floor(new Date(data).getTime() / 1000);
  const linhas = [];
  if (!ficha) {
    linhas.push('Nenhuma ficha de recrutamento enviada por esta pessoa.');
  } else {
    const rotulo = { PENDENTE: 'em análise', APROVADO: 'aprovada', REPROVADO: 'reprovada' }[ficha.status] ?? ficha.status.toLowerCase();
    linhas.push(`Última ficha: **${rotulo}** (enviada <t:${seg(ficha.criado_em)}:R>) — [abrir](${link(config.canais.validarSetagem, ficha.message_id)})`);
    if (ficha.status === 'PENDENTE') linhas.push('A equipe pode decidir a ficha por lá; o ticket não substitui a análise.');
    if (ficha.status === 'REPROVADO') {
      linhas.push(`Motivo: **${F.nomeSeguro(ficha.reprovado_categoria ?? 'não informado')}** · ${ficha.permite_reenvio === false ? '**reprovação definitiva** (só a liderança libera novo envio)' : 'pode enviar nova ficha'}`);
    }
    if (ficha.status === 'APROVADO') {
      linhas.push(`Aprovada por <@${ficha.decidido_por_id}>. ID no jogo: **${ficha.id_fivem ?? '?'}**.`);
    }
    const avisos = await require('./barreira').avaliarCandidato({ nome: ficha.nome ?? '', idFivem: ficha.id_fivem ?? '' }).catch(() => []);
    if (avisos.length) linhas.push('', '⚠️ **Atenção:**', ...avisos);
  }
  await canal.send({
    embeds: [{
      color: tema.cor.primaria,
      title: '📋 CONTEXTO DO CANDIDATO',
      description: linhas.join('\n'),
      footer: { text: 'Visível a quem tem acesso ao ticket · só informa' },
    }],
    allowedMentions: { parse: [] },
  });
}

// ── Enriquecimento de fichas existentes ──────────────────────────────────────

function campoResumo(r) {
  if (!r) return null;
  const d = r.dados;
  const nivel = r.risco >= 60 ? 'ALTO' : r.risco >= 30 ? 'MÉDIO' : 'BAIXO';
  const linhas = [
    `**Risco:** ${r.risco} (${nivel})${d.fatores?.length ? ` — ${d.fatores.slice(0, 3).join(' · ')}` : ''}`,
    `**Jogo:** ${E.formatarDuracao(d.h7Ms)} em 7 dias · ${E.formatarDuracao(d.h28Ms)} em 28 dias${d.esfriando ? ' (em queda)' : ''}`,
    `**Baú/Banco (28 dias):** ${R.contribuicao(d.bau.entrou, d.bau.saiu).papel.toLowerCase()} · ${R.contribuicao(d.banco.entrou, d.banco.saiu).papel.toLowerCase()}`,
  ];
  return { name: '🧯 INTELIGÊNCIA CRUZADA', value: linhas.join('\n') };
}

function registrarEnriquecedores() {
  enriquecedores.registrar('historico.resumo', async ({ idFivem }) => campoResumo(await repo.resumoPorIdFivem(idFivem)));
  enriquecedores.registrar('adv.contexto', async ({ membro }) => campoResumo(await repo.resumoDe(membro.id)));
}

// ── Assinaturas ──────────────────────────────────────────────────────────────

function assinar() {
  registrarTipo(TIPO_ACOMPANHAMENTO, acompanhar);
  barramento.assinar('ficha.decidida', aoFichaDecidida);
  barramento.assinar('adv.registrada', aoAdvRegistrada);
  barramento.assinar('adv.removida', aoAdvRemovida);
  barramento.assinar('ticket.aberto', aoTicketAberto);
  barramento.assinar('adv.restricao_pendente', aoRestricaoPendente);
  barramento.assinar('adv.pendencia_encerrada', aoPendenciaEncerrada);
  registrarEnriquecedores();
}

module.exports = {
  assinar, ETAPAS, TIPO_ACOMPANHAMENTO, acompanhar, aoFichaDecidida, aoAdvRegistrada, aoAdvRemovida, aoTicketAberto,
  aoRestricaoPendente, aoPendenciaEncerrada, atualizarMembro, campoResumo,
};
