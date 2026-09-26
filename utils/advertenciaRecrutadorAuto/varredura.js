// Advertência automática de recrutador: varredura periódica que cruza a inteligência
// de recrutadores (logs do jogo), o placar do manto e as fichas com a escada de
// advertências. Regras puras em regras.js; aqui ficam Discord, banco e tempo.
const config = require('../../config/index.js');
const tema = require('../../tema');
const { agendar, registrarTipo } = require('../agendador');
const { lerConfig, gravarConfig } = require('../botConfig');
const R = require('./regras');
const repo = require('./repositorio');
const { mencoesDoRecrutador } = require('../advertencia/mencoes');

const INTERVALO_MS = 3 * 60 * 60 * 1000;
const ATRASO_INICIAL_MS = 2 * 60 * 1000;
const agoraSeg = () => Math.floor(Date.now() / 1000);
const periodoDe = (dias, agora) => ({ chave: `${dias}d`, rotulo: `ÚLTIMOS ${dias} DIAS`, inicio: new Date(agora - dias * R.DIA_MS), fim: agora });

const cargosAdvRec = () => (Array.isArray(config.cargos.advRec) && config.cargos.advRec.length === 3 && config.cargos.advRec.every(Boolean)
  ? config.cargos.advRec : null);

// Métricas por recrutador. Recusa trabalhar com fonte parada: sem log recente não
// dá para distinguir "não recrutou" de "o jogo parou de mandar log".
async function coletarDados(client, agora = new Date()) {
  const logs = require('../logsJogo/repositorio');
  const { recrutadoresDoPeriodo } = require('../logsJogo/painelRecrutadoresInteracoes');
  const ultima = await logs.ultimaOcorrencia(['jogador_recrutou', 'jogador_entrou', 'jogador_saiu']);
  if (!ultima || (agora - new Date(ultima)) > config.logsJogo.fonteParadaDias * R.DIA_MS) {
    throw new Error('fonte de logs parada: varredura ignorada');
  }
  const guild = await client.guilds.fetch(config.guildId);
  const L = R.LIMITES;
  const [p5, p7, p14] = [L.diasSemRecrutarJogando, L.diasInativo, L.diasRetencao].map(d => periodoDe(d, agora));
  const desdeOcorrencias = new Date(agora - L.diasOcorrencias * R.DIA_MS);
  const l5 = await recrutadoresDoPeriodo(guild, p5, agora);
  const [l7, l14, erros, incompletas, cargoDesde, ultimas] = await Promise.all([
    recrutadoresDoPeriodo(guild, p7, agora), recrutadoresDoPeriodo(guild, p14, agora),
    repo.errosDeMantoPorRecrutador(desdeOcorrencias), repo.fichasIncompletasPorRecrutador(desdeOcorrencias),
    repo.cargoDesdeComPromocao(l5), repo.ultimasPorRegra(),
  ]);
  const por7 = new Map(l7.map(l => [l.discordId, l]));
  const por14 = new Map(l14.map(l => [l.discordId, l]));
  const ultimosRecrutamentos = new Map((await logs.ultimaPorAtorNaLista(['jogador_recrutou'], l5.filter(l => l.idFivem).map(l => l.idFivem)))
    .map(r => [r.id, r.ultima]));
  return l5
    .filter(l => l.idFivem) // sem ID no apelido não dá para medir (o painel já cobra o vínculo)
    .map(l => ({
      discordId: l.discordId, idFivem: l.idFivem,
      ultimoRecrutou: ultimosRecrutamentos.get(l.idFivem) ?? null, ultimaConexaoEm: l.ultimaConexao?.em ?? null,
      rec5: l.recrutamentos, ms5: l.ms, online: l.online,
      rec7: por7.get(l.discordId)?.recrutamentos ?? 0, ms7: por7.get(l.discordId)?.ms ?? 0,
      rec14: por14.get(l.discordId)?.recrutamentos ?? 0, saiuCedo14: por14.get(l.discordId)?.saiuCedo ?? 0,
      erros7: erros.get(l.discordId) ?? 0, incompletas7: incompletas.get(l.discordId) ?? 0,
      cargoDesde: cargoDesde.get(l.discordId) ?? null,
      ultimaPorRegra: ultimas.get(l.discordId) ?? {},
    }));
}

async function recrutamentosDesde(idFivem, desde, agora) {
  const logs = require('../logsJogo/repositorio');
  const linhas = await logs.contarPorAtorNaLista(['jogador_recrutou'], [idFivem], { inicio: desde, fim: agora });
  return linhas[0]?.total ?? 0;
}

async function membroDe(guild, id) {
  return guild.members.fetch(id).catch(() => null);
}

// `discordId`: o recrutador do caso; a liderança é sempre mencionada junto.
async function avisar(guild, embed, discordId) {
  const canal = await guild.channels.fetch(config.canais.historicoAdvRec).catch(() => null);
  if (canal) await canal.send({ content: mencoesDoRecrutador(discordId), embeds: [embed] }).catch(err => console.error('[adv-rec-auto] Erro ao postar:', err));
}

// Cargo ADV¹/²/³ do recrutador (só se o tenant configurou cargos.advRec): tira o
// anterior e põe o do nível. Falha de cargo é logada, o registro segue.
async function marcarNivel(membro, nivel) {
  const cargos = cargosAdvRec();
  if (!membro || !cargos) return;
  try {
    for (const id of cargos) if (membro.roles.cache.has(id)) await membro.roles.remove(id);
    if (nivel >= 1 && nivel <= 3) await membro.roles.add(cargos[nivel - 1]);
  } catch (err) {
    console.error('[adv-rec-auto] Erro ao ajustar cargo ADV:', err);
  }
}

const camposBase = (id, extra = []) => [{ name: 'RECRUTADOR', value: `<@${id}>`, inline: true }, ...extra];

async function removerCargoRecrutador(guild, membro, discordId, regra, motivo, nivel = 0) {
  if (membro) await membro.roles.remove(config.cargos.recrutador); // erro sobe: nada é registrado se o Discord recusou
  const linha = await repo.inserir({ discordId, nivel, regra, motivo, status: 'CARGO_REMOVIDO' });
  await avisar(guild, {
    color: tema.cor.perigo,
    title: nivel ? `❌ ADV. RECRUTAMENTO ${nivel}ª (AUTOMÁTICA) — CARGO DE RECRUTADOR REMOVIDO` : '❌ CARGO DE RECRUTADOR REMOVIDO POR INATIVIDADE',
    fields: camposBase(discordId, [
      { name: 'REGRA', value: R.REGRAS[regra]?.rotulo ?? 'INATIVIDADE', inline: true },
      { name: 'JUSTIFICATIVA', value: motivo },
      { name: 'DATA', value: `<t:${agoraSeg()}:F>` },
    ]),
  }, discordId);
  return linha;
}

async function advertir(guild, discordId, infracao, agora) {
  const membro = await membroDe(guild, discordId);
  if (!membro) return null;
  const plano = R.planoDaAdvertencia(await repo.contarAtivas(discordId), infracao.regra);
  if (plano.removeCargo) {
    await marcarNivel(membro, 3);
    return removerCargoRecrutador(guild, membro, discordId, infracao.regra, infracao.motivo, plano.nivel);
  }
  const prazoEm = plano.prazoMs ? new Date(agora.getTime() + plano.prazoMs) : null;
  await marcarNivel(membro, plano.nivel);
  const linha = await repo.inserir({ discordId, nivel: plano.nivel, regra: infracao.regra, motivo: infracao.motivo, prazoEm });
  const expiraEm = prazoEm ? Math.floor(prazoEm.getTime() / 1000) : null;
  await avisar(guild, {
    color: tema.cor.perigo,
    title: `❌ ADV. RECRUTAMENTO ${plano.nivel}ª (AUTOMÁTICA)`,
    fields: camposBase(discordId, [
      { name: 'REGRA', value: R.REGRAS[infracao.regra].rotulo, inline: true },
      { name: 'JUSTIFICATIVA', value: infracao.motivo },
      ...(prazoEm ? [{ name: 'PRAZO', value: `Voltar a recrutar (${R.LIMITES.perdaoRecrutamentos} recrutamentos) até <t:${expiraEm}:F>. Sem isso, perde o cargo de recrutador.` }] : []),
      { name: 'DATA', value: `<t:${agoraSeg()}:F>` },
    ]),
    footer: { text: plano.nivel === 2 ? 'A próxima advertência remove o cargo de recrutador.' : 'Advertência automática, gerada pelo cruzamento com os logs do jogo.' },
  }, discordId);
  if (prazoEm) {
    await agendar('adv_rec_auto_vencimento', prazoEm, { advId: linha.id, membroId: discordId })
      .catch(err => console.error('[adv-rec-auto] Erro ao agendar vencimento:', err));
  }
  return linha;
}

// Perdão (recrutou o suficiente depois da advertência por inatividade) e validade
async function resolverAtivas(guild, dadosPorId, agora) {
  for (const adv of await repo.ativas()) {
    try {
      const membro = await membroDe(guild, adv.discord_id);
      const idFivem = dadosPorId.get(adv.discord_id)?.idFivem;
      let status = null;
      let resolucao = null;
      if (adv.regra === 'sem_recrutar_jogando' && idFivem && R.perdoada(await recrutamentosDesde(idFivem, adv.criada_em, agora))) {
        status = 'PERDOADA'; resolucao = `Voltou a recrutar (${R.LIMITES.perdaoRecrutamentos}+ recrutamentos)`;
      } else if (R.expirada(adv.criada_em, agora)) {
        status = 'EXPIRADA'; resolucao = `Passou de ${R.LIMITES.validadeDias} dias sem reincidência`;
      }
      if (!status || !(await repo.encerrar(adv.id, status, resolucao))) continue;
      await marcarNivel(membro, await repo.contarAtivas(adv.discord_id));
      await avisar(guild, {
        color: tema.cor.primaria,
        title: `🦅 ADV. RECRUTAMENTO ${adv.nivel}ª ${status === 'PERDOADA' ? 'REMOVIDA' : 'EXPIRADA'}`,
        fields: camposBase(adv.discord_id, [{ name: 'MOTIVO', value: resolucao }, { name: 'DATA', value: `<t:${agoraSeg()}:F>` }]),
      }, adv.discord_id);
    } catch (err) {
      console.error('[adv-rec-auto] Erro ao resolver advertência:', err);
    }
  }
}

// Quem tem advertência ativa na tabela precisa ter o cargo ADV do nível. Corrige
// advertências anteriores à configuração dos cargos e cargos removidos na mão.
async function sincronizarCargos(guild) {
  const cargos = cargosAdvRec();
  if (!cargos) return;
  const ativas = new Map();
  for (const adv of await repo.ativas()) ativas.set(adv.discord_id, (ativas.get(adv.discord_id) ?? 0) + 1);
  for (const [discordId, total] of ativas) {
    const membro = await membroDe(guild, discordId);
    if (!membro?.roles.cache.has(config.cargos.recrutador)) continue;
    const nivel = Math.min(total, 3);
    const tem = cargos.filter(id => membro.roles.cache.has(id));
    if (tem.length === 1 && tem[0] === cargos[nivel - 1]) continue;
    await marcarNivel(membro, nivel);
  }
}

// Riscos da última varredura por recrutador ({ regra, texto, restamDias }): o painel
// de recrutadores os mostra em ATENÇÃO sem refazer as 3 janelas de consulta.
let riscosPorRecrutador = new Map();
const riscosDaUltimaVarredura = () => riscosPorRecrutador;

const CHAVE_AVISOS = 'adv_rec_avisos_preventivos';

async function lerAvisos() {
  try {
    return JSON.parse((await lerConfig(CHAVE_AVISOS)) ?? '{}');
  } catch {
    return {};
  }
}

// Aviso preventivo: quem está a poucos dias de cruzar um limite recebe DM e o
// canal do histórico registra. Cada (recrutador, regra) avisa uma vez por
// `AVISO.repeticaoDias`; nada disso é advertência (não entra na escada).
async function avisarRiscos(guild, dados, agora) {
  const avisos = await lerAvisos();
  const limite = agora.getTime() - R.AVISO.repeticaoDias * R.DIA_MS;
  for (const [chave, quando] of Object.entries(avisos)) if (quando < limite) delete avisos[chave];
  const novos = [];
  for (const d of dados) {
    for (const risco of riscosPorRecrutador.get(d.discordId) ?? []) {
      const chave = `${d.discordId}:${risco.regra}`;
      if (avisos[chave]) continue;
      avisos[chave] = agora.getTime();
      novos.push([d.discordId, risco]);
    }
  }
  for (const [discordId, risco] of novos) {
    const rotulo = R.REGRAS[risco.regra]?.rotulo ?? 'INATIVIDADE';
    const embed = {
      color: tema.cor.aviso,
      title: '⚠️ RISCO DE ADVERTÊNCIA (AUTOMÁTICO)',
      fields: camposBase(discordId, [
        { name: 'REGRA', value: rotulo, inline: true },
        { name: 'SITUAÇÃO', value: risco.texto },
      ]),
      footer: { text: 'Aviso preventivo: ainda não é advertência.' },
    };
    await avisar(guild, embed, discordId);
    const membro = await membroDe(guild, discordId);
    try {
      await membro?.send({ embeds: [{ ...embed, title: '⚠️ ATENÇÃO, RECRUTADOR', fields: [{ name: 'REGRA', value: rotulo, inline: true }, { name: 'SITUAÇÃO', value: risco.texto }] }] });
    } catch { /* DM fechada: o aviso no canal já ficou registrado */ }
  }
  if (novos.length) await gravarConfig(CHAVE_AVISOS, JSON.stringify(avisos));
  return novos.map(([id, r]) => [id, r.regra]);
}

// Uma passada completa. `coletar` é injetável (teste); em produção lê logs/fichas/mantos.
async function executarVarredura(client, { agora = new Date(), coletar = coletarDados } = {}) {
  const guild = await client.guilds.fetch(config.guildId);
  const dados = await coletar(client, agora);
  const porId = new Map(dados.map(d => [d.discordId, d]));
  const resultado = { advertidos: [], cargosRemovidos: [], avisados: [] };

  await resolverAtivas(guild, porId, agora);
  for (const d of dados) {
    try {
      const decisao = R.decidir(d, agora);
      if (decisao.removerCargo) {
        const membro = await membroDe(guild, d.discordId);
        if (!membro?.roles.cache.has(config.cargos.recrutador)) continue;
        await removerCargoRecrutador(guild, membro, d.discordId, 'inatividade', decisao.removerCargo);
        resultado.cargosRemovidos.push(d.discordId);
        continue;
      }
      for (const infracao of decisao.infracoes) {
        if (await advertir(guild, d.discordId, infracao, agora)) resultado.advertidos.push([d.discordId, infracao.regra]);
      }
    } catch (err) {
      console.error('[adv-rec-auto] Erro ao avaliar recrutador:', err);
    }
  }
  await sincronizarCargos(guild).catch(err => console.error('[adv-rec-auto] Erro ao sincronizar cargos ADV:', err));
  // Riscos só de quem segue com o cargo e não foi advertido agora pela mesma regra.
  const advertidosAgora = new Set(resultado.advertidos.map(([id, regra]) => `${id}:${regra}`));
  riscosPorRecrutador = new Map(dados
    .filter(d => !resultado.cargosRemovidos.includes(d.discordId))
    .map(d => [d.discordId, R.riscos(d, agora).filter(r => !advertidosAgora.has(`${d.discordId}:${r.regra}`))])
    .filter(([, lista]) => lista.length));
  try {
    resultado.avisados = await avisarRiscos(guild, dados, agora);
  } catch (err) {
    console.error('[adv-rec-auto] Erro nos avisos preventivos:', err);
  }
  require('./paineis').atualizarAdvertidos(client);
  // O quadro de recrutadores (datas e gestores) acompanha as promoções novas dos logs
  require('../quadroRecrutadores').atualizarQuadroRecrutadores(client)
    .catch(err => console.error('[adv-rec-auto] Erro ao atualizar o quadro de recrutadores:', err));
  return resultado;
}

// 2ª por inatividade venceu sem o recrutador voltar a recrutar: perde o cargo
registrarTipo('adv_rec_auto_vencimento', async (client, p) => {
  const linha = await repo.encerrar(p.advId, 'VENCIDA', 'Prazo vencido sem voltar a recrutar');
  if (!linha) return; // já perdoada/expirada/removida
  const guild = await client.guilds.fetch(config.guildId);
  const membro = await membroDe(guild, p.membroId);
  if (membro?.roles.cache.has(config.cargos.recrutador)) await membro.roles.remove(config.cargos.recrutador);
  await marcarNivel(membro, 0);
  await avisar(guild, {
    color: tema.cor.perigo,
    title: '❌ ADV. RECRUTAMENTO NÃO REGULARIZADA — CARGO DE RECRUTADOR REMOVIDO',
    fields: camposBase(p.membroId, [{ name: 'MOTIVO', value: linha.motivo }, { name: 'DATA', value: `<t:${agoraSeg()}:F>` }]),
  }, p.membroId);
  require('./paineis').atualizarAdvertidos(client);
});

let timer = null;
function iniciar(client) {
  const rodar = () => executarVarredura(client).catch(err => console.error('[adv-rec-auto] Varredura falhou:', err.message));
  setTimeout(rodar, ATRASO_INICIAL_MS).unref();
  timer = setInterval(rodar, INTERVALO_MS);
  timer.unref();
}

module.exports = { executarVarredura, coletarDados, iniciar, riscosDaUltimaVarredura };
