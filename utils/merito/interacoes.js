// Mérito de recrutadores: botões, selects e modais. customId: merito:<acao>[:...]
//   merito:extrato · merito:dispensa → merito:dispensa_sel → merito:dispensa_modal:<semana>
//   merito:votar:<ciclo>:<indicado|0> · merito:pendencias → merito:pend_sel → merito:pend_dec:<id>
//   merito:vetar → merito:vetar_sel → merito:vetar_modal:<ciclo>:<indicado>
//   merito:decisao → merito:decisao_sel · merito:config → merito:cfg_sel → merito:cfg_modal:<chave>
// Edição de dado = botão → select → modal de UM campo (docs/contratos/padroes-ui.md).
const { ActionRowBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const tema = require('../../tema');
const { registrarModulo } = require('../modulos');
const { ehLideranca, ehPresidencia, ehRecrutadorOuAcima, MSG_SO_LIDERANCA } = require('../permissoes');
const R = require('./regras');
const repo = require('./repositorio');
const X = require('./extrato');
const P = require('./paineis');
const S = require('./servico');

const efemero = conteudo => ({ content: conteudo, flags: 64 });
const MSG_SO_RECRUTADOR = '❌ SÓ RECRUTADORES E ACIMA USAM O MÉRITO.';
const MSG_SO_PRESIDENCIA = '❌ APENAS A PRESIDÊNCIA (PRESIDENTE E VICE) PODE USAR ESTE RECURSO.';
const rotuloCorto = (texto, max = 100) => String(texto).slice(0, max);

const seletor = (id, placeholder, opcoes) => new ActionRowBuilder().addComponents(
  new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).addOptions(opcoes)
);

const modalDeUmCampo = ({ id, titulo, campo, rotulo, estilo = TextInputStyle.Paragraph, min = 1, max = 300 }) => new ModalBuilder()
  .setCustomId(id).setTitle(titulo)
  .addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId(campo).setLabel(rotulo).setStyle(estilo).setRequired(true).setMinLength(min).setMaxLength(max)
  ));

// ── Extrato ──────────────────────────────────────────────────────────────────

async function payloadExtrato(discordId, nome, efemera = true) {
  const ciclo = (await repo.cicloAberto()) ?? (await repo.ultimoCiclo());
  if (!ciclo) return efemera ? efemero('⚠️ O PRIMEIRO CICLO DO MÉRITO AINDA NÃO ABRIU.') : { content: '⚠️ O PRIMEIRO CICLO DO MÉRITO AINDA NÃO ABRIU.' };
  const [resultado, semanas, selos] = await Promise.all([repo.resultadoDe(ciclo.id, discordId), repo.semanasDe(ciclo.id, discordId), repo.selosDe(discordId)]);
  const embeds = [X.embedExtrato({ ciclo, resultado, semanas, selos, nome })];
  return efemera ? { embeds, flags: 64 } : { embeds };
}

async function extrato(interaction) {
  if (!ehRecrutadorOuAcima(interaction.member)) return interaction.reply(efemero(MSG_SO_RECRUTADOR));
  return interaction.reply(await payloadExtrato(interaction.user.id, interaction.member?.displayName));
}

// ── Semana dispensada ────────────────────────────────────────────────────────

async function abrirDispensa(interaction, agora = new Date()) {
  if (!ehRecrutadorOuAcima(interaction.member)) return interaction.reply(efemero(MSG_SO_RECRUTADOR));
  const ciclo = await repo.cicloAberto();
  if (!ciclo) return interaction.reply(efemero('⚠️ NÃO HÁ CICLO ABERTO.'));
  const pedidos = await repo.pedidosDeDispensa(ciclo.id, interaction.user.id);
  if (pedidos.length >= R.LIMITES.semanasDispensadasPorCiclo) {
    return interaction.reply(efemero(`⚠️ VOCÊ JÁ USOU AS ${R.LIMITES.semanasDispensadasPorCiclo} SEMANA(S) DISPENSADA(S) DESTE CICLO.`));
  }
  const opcoes = R.datasDoCiclo(ciclo.inicio).semanas.filter(s => s.inicio <= agora)
    .map(s => ({ label: `Semana ${s.indice + 1} (${X.dataCurta(s.inicio)} a ${X.dataCurta(new Date(s.fim - 1))})`, value: String(s.indice) }));
  return interaction.reply({
    content: `**QUAL SEMANA VOCÊ QUER DISPENSAR?** Ausência avisada (viagem, doença): a liderança aprova e a semana sai da conta, sem punir nem premiar. Limite de ${R.LIMITES.semanasDispensadasPorCiclo} por ciclo.`,
    components: [seletor('merito:dispensa_sel', 'ESCOLHA A SEMANA', opcoes)],
    flags: 64,
  });
}

async function escolherSemana(interaction) {
  const semana = Number(interaction.values?.[0]);
  if (!Number.isInteger(semana)) return interaction.reply(efemero('⚠️ SEMANA INVÁLIDA.'));
  return interaction.showModal(modalDeUmCampo({
    id: `merito:dispensa_modal:${semana}`, titulo: `DISPENSAR SEMANA ${semana + 1}`, campo: 'motivo', rotulo: 'MOTIVO DA AUSÊNCIA', min: 10, max: 300,
  }));
}

async function enviarDispensa(interaction, semana) {
  // Permissão conferida de novo: o modal pode ter ficado aberto depois de perder o cargo
  if (!ehRecrutadorOuAcima(interaction.member)) return interaction.reply(efemero(MSG_SO_RECRUTADOR));
  const motivo = interaction.fields.getTextInputValue('motivo').trim();
  if (motivo.length < 10) return interaction.reply(efemero('⚠️ CONTE O MOTIVO COM PELO MENOS 10 CARACTERES.'));
  await interaction.deferReply({ flags: 64 });
  const r = await S.pedirDispensa(interaction.client, { discordId: interaction.user.id, semana: Number(semana), motivo });
  return interaction.editReply({ content: r.ok ? `${tema.emoji.ok} PEDIDO ENVIADO. A LIDERANÇA VAI ANALISAR E VOCÊ RECEBE A RESPOSTA POR DM.` : r.mensagem });
}

// ── Votação ──────────────────────────────────────────────────────────────────

async function votar(interaction, cicloId, indicadoId) {
  if (!ehLideranca(interaction.member)) return interaction.reply(efemero(MSG_SO_LIDERANCA));
  const r = await S.registrarVoto(interaction.client, { cicloId, votanteId: interaction.user.id, indicadoId });
  if (!r.ok) return interaction.reply(efemero(r.mensagem));
  const ate = `<t:${X.seg(r.ciclo.votacao_ate)}:R>`;
  return interaction.reply(efemero(r.abster
    ? `${tema.emoji.ok} ABSTENÇÃO REGISTRADA. VOCÊ PODE TROCAR ATÉ ${ate}.`
    : `${tema.emoji.ok} VOTO REGISTRADO. VOCÊ PODE TROCAR ATÉ ${ate}. O PLACAR FICA OCULTO ATÉ O ENCERRAMENTO.`));
}

async function abrirVeto(interaction) {
  if (!ehPresidencia(interaction.member)) return interaction.reply(efemero(MSG_SO_PRESIDENCIA));
  const ciclo = await repo.cicloEmVotacao();
  if (!ciclo) return interaction.reply(efemero('⚠️ NÃO HÁ VOTAÇÃO ABERTA.'));
  const indicados = (await repo.resultadosDoCiclo(ciclo.id)).filter(r => r.indicado);
  return interaction.reply({
    content: '**QUAL INDICADO VOCÊ QUER VETAR?** O veto exige um motivo e fica registrado.',
    components: [seletor('merito:vetar_sel', 'ESCOLHA O INDICADO', indicados.map(r => ({ label: rotuloCorto(r.detalhe?.nome ?? r.discord_id), value: `${ciclo.id}:${r.discord_id}` })))],
    flags: 64,
  });
}

async function escolherVeto(interaction) {
  const [cicloId, indicadoId] = String(interaction.values?.[0] ?? '').split(':');
  if (!cicloId || !indicadoId) return interaction.reply(efemero('⚠️ ESCOLHA INVÁLIDA.'));
  return interaction.showModal(modalDeUmCampo({
    id: `merito:vetar_modal:${cicloId}:${indicadoId}`, titulo: 'VETAR INDICADO', campo: 'motivo', rotulo: 'MOTIVO DO VETO', min: 10, max: 300,
  }));
}

async function enviarVeto(interaction, cicloId, indicadoId) {
  if (!ehPresidencia(interaction.member)) return interaction.reply(efemero(MSG_SO_PRESIDENCIA));
  const motivo = interaction.fields.getTextInputValue('motivo').trim();
  if (motivo.length < 10) return interaction.reply(efemero('⚠️ INFORME O MOTIVO DO VETO (MÍNIMO 10 CARACTERES).'));
  const r = await S.registrarVeto(interaction.client, { cicloId, indicadoId, vetadoPor: interaction.user.id, motivo });
  return interaction.reply(efemero(r.ok ? `${tema.emoji.ok} VETO REGISTRADO.` : r.mensagem));
}

// ── Pendências (fraude e dispensa) ───────────────────────────────────────────

async function abrirPendencias(interaction) {
  if (!ehLideranca(interaction.member)) return interaction.reply(efemero(MSG_SO_LIDERANCA));
  const ciclo = await repo.cicloAberto();
  const pendentes = ciclo ? await repo.revisoesPendentes(ciclo.id) : [];
  if (!pendentes.length) return interaction.reply(efemero(`${tema.emoji.ok} NADA ESPERANDO DECISÃO.`));
  return interaction.reply({
    content: `**ESCOLHA A PENDÊNCIA** (${pendentes.length})`,
    components: [seletor('merito:pend_sel', 'PENDÊNCIA', pendentes.slice(0, 25).map(p => ({
      label: rotuloCorto(`#${p.id} · ${P.rotuloRevisao(p)}`), description: rotuloCorto(p.detalhe?.motivo ?? p.discord_id, 100), value: String(p.id),
    })))],
    flags: 64,
  });
}

async function escolherPendencia(interaction) {
  if (!ehLideranca(interaction.member)) return interaction.reply(efemero(MSG_SO_LIDERANCA));
  const revisao = await repo.buscarRevisao(interaction.values?.[0]);
  if (!revisao || revisao.status !== 'PENDENTE') return interaction.reply(efemero('⚠️ ESTA PENDÊNCIA JÁ FOI DECIDIDA.'));
  const dispensa = revisao.tipo === 'dispensa';
  const detalhe = dispensa
    ? `Motivo: ${revisao.detalhe?.motivo ?? '—'}`
    : `Os recrutamentos do lote estão retidos e não contam até a decisão. ${revisao.detalhe?.quantidade ? `${revisao.detalhe.quantidade} recrutamentos.` : ''}`;
  return interaction.reply({
    content: `**#${revisao.id} · ${P.rotuloRevisao(revisao)}** · <@${revisao.discord_id}>\n${detalhe}`,
    components: [seletor(`merito:pend_dec:${revisao.id}`, 'DECISÃO', dispensa
      ? [{ label: 'APROVAR: a semana sai da conta', value: 'APROVADA' }, { label: 'NEGAR: a semana conta normalmente', value: 'NEGADA' }]
      : [{ label: 'LIBERAR: os recrutamentos contam', value: 'APROVADA' }, { label: 'DESCARTAR: os recrutamentos não contam', value: 'NEGADA' }])],
    flags: 64,
  });
}

async function decidirPendencia(interaction, revisaoId) {
  if (!ehLideranca(interaction.member)) return interaction.reply(efemero(MSG_SO_LIDERANCA));
  const r = await S.decidirPendencia(interaction.client, { revisaoId, decisao: interaction.values?.[0], por: interaction.user.id });
  return interaction.reply(efemero(r.ok ? `${tema.emoji.ok} PENDÊNCIA DECIDIDA. O RANKING SERÁ RECALCULADO.` : r.mensagem));
}

// ── Decisão final (registro) ─────────────────────────────────────────────────

async function abrirDecisao(interaction) {
  if (!ehPresidencia(interaction.member)) return interaction.reply(efemero(MSG_SO_PRESIDENCIA));
  const concluido = await repo.ultimoConcluido();
  if (!concluido) return interaction.reply(efemero('⚠️ NENHUMA VOTAÇÃO ENCERRADA PARA REGISTRAR DECISÃO.'));
  const indicados = (await repo.resultadosDoCiclo(concluido.id)).filter(r => r.indicado);
  const opcoes = indicados.flatMap(r => ['PROMOVIDO', 'ADIADO'].map(d => ({
    label: rotuloCorto(`${d}: ${r.detalhe?.nome ?? r.discord_id}`), value: `${d}:${concluido.id}:${r.discord_id}`,
  })));
  return interaction.reply({
    content: `**REGISTRAR DECISÃO DO CICLO ${concluido.numero}.** O bot só registra: a promoção em si é feita por vocês.`,
    components: [seletor('merito:decisao_sel', 'DECISÃO', opcoes.slice(0, 25))],
    flags: 64,
  });
}

async function registrarDecisao(interaction) {
  if (!ehPresidencia(interaction.member)) return interaction.reply(efemero(MSG_SO_PRESIDENCIA));
  const [decisao, cicloId, discordId] = String(interaction.values?.[0] ?? '').split(':');
  const r = await S.registrarDecisaoFinal(interaction.client, { cicloId, discordId, decisao, por: interaction.user.id });
  return interaction.reply(efemero(r.ok ? `${tema.emoji.ok} DECISÃO REGISTRADA: ${decisao}.` : r.mensagem));
}

// ── Ajuste das regras (vale no próximo ciclo) ────────────────────────────────

async function abrirConfig(interaction) {
  if (!ehPresidencia(interaction.member)) return interaction.reply(efemero(MSG_SO_PRESIDENCIA));
  const atuais = await S.lerRegrasAtuais();
  return interaction.reply({
    content: '**QUAL REGRA VOCÊ QUER AJUSTAR?** O ajuste vale a partir do **próximo ciclo**: o ciclo aberto não muda no meio.',
    components: [seletor('merito:cfg_sel', 'REGRA', Object.entries(S.REGRAS_EDITAVEIS).map(([chave, def]) => ({
      label: def.rotulo, description: `Atual: ${atuais[def.campo]}`, value: chave,
    })))],
    flags: 64,
  });
}

async function escolherConfig(interaction) {
  const chave = interaction.values?.[0];
  const def = S.REGRAS_EDITAVEIS[chave];
  if (!def) return interaction.reply(efemero('⚠️ REGRA DESCONHECIDA.'));
  return interaction.showModal(modalDeUmCampo({
    id: `merito:cfg_modal:${chave}`, titulo: def.rotulo.slice(0, 45), campo: 'valor', rotulo: `NOVO VALOR (${def.min} A ${def.max})`,
    estilo: TextInputStyle.Short, min: 1, max: 3,
  }));
}

async function enviarConfig(interaction, chave) {
  if (!ehPresidencia(interaction.member)) return interaction.reply(efemero(MSG_SO_PRESIDENCIA));
  const r = await S.definirRegra(chave, interaction.fields.getTextInputValue('valor'));
  return interaction.reply(efemero(r.ok ? `${tema.emoji.ok} ${r.rotulo}: **${r.valor}**. VALE A PARTIR DO PRÓXIMO CICLO.` : r.mensagem));
}

registrarModulo('merito', async interaction => {
  const [, acao, a, b] = interaction.customId.split(':');
  switch (acao) {
    case 'extrato': return extrato(interaction);
    case 'dispensa': return abrirDispensa(interaction);
    case 'dispensa_sel': return escolherSemana(interaction);
    case 'dispensa_modal': return enviarDispensa(interaction, a);
    case 'votar': return votar(interaction, a, b);
    case 'vetar': return abrirVeto(interaction);
    case 'vetar_sel': return escolherVeto(interaction);
    case 'vetar_modal': return enviarVeto(interaction, a, b);
    case 'pendencias': return abrirPendencias(interaction);
    case 'pend_sel': return escolherPendencia(interaction);
    case 'pend_dec': return decidirPendencia(interaction, a);
    case 'decisao': return abrirDecisao(interaction);
    case 'decisao_sel': return registrarDecisao(interaction);
    case 'config': return abrirConfig(interaction);
    case 'cfg_sel': return escolherConfig(interaction);
    case 'cfg_modal': return enviarConfig(interaction, a);
    default: return null;
  }
});

module.exports = { payloadExtrato };
