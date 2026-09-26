// Advertência automática de sócio: o que o painel do jogo registra (impedimento,
// advertência) vira advertência no Discord, com tabela própria. Regras puras em
// automaticaRegras.js; aqui ficam o Discord (cargos, canais) e o banco.
const config = require('../../config/index.js');
const tema = require('../../tema');
const { agendar } = require('../agendador');
const { garantirMembrosCarregados } = require('../membrosGuild');
const { idFivemDoNick } = require('../logsJogo/estatisticas');
const R = require('./automaticaRegras');
const repo = require('./repositorio');
const { mencoesDoSocio } = require('./mencoes');

const ROTULO_ORIGEM = { impedimento: 'IMPEDIMENTO', advertido: 'ADVERTÊNCIA' };
const agoraSeg = () => Math.floor(Date.now() / 1000);

async function sociosPorIdFivem(client, idFivem) {
  const guild = await client.guilds.fetch(config.guildId);
  await garantirMembrosCarregados(guild);
  const membro = guild.members.cache.find(m => idFivemDoNick(m.nickname ?? m.displayName) === idFivem);
  return { guild, membro };
}

async function enviar(guild, canalId, embed, content) {
  const canal = await guild.channels.fetch(canalId).catch(() => null);
  if (!canal) return false;
  await canal.send({ ...(content ? { content } : {}), embeds: [embed] });
  return true;
}

function campoMembro(membro, registro, origem) {
  return [
    { name: 'MEMBRO', value: `<@${membro.id}>`, inline: true },
    { name: 'ID NO JOGO', value: `#${registro.alvoIdFivem}`, inline: true },
    { name: 'ORIGEM', value: `${ROTULO_ORIGEM[origem]} NO PAINEL DO JOGO`, inline: true },
  ];
}

function justificativa(registro) {
  const quem = registro.atorNome ? ` (por ${registro.atorNome})` : '';
  return `${(registro.descricao || 'Registro do painel sem descrição.').slice(0, 900)}${quem}`;
}

// ── Abrir ─────────────────────────────────────────────────────────────────
async function abrir(client, registro, g) {
  const { guild, membro } = await sociosPorIdFivem(client, g.idFivem);
  if (!membro || !membro.roles.cache.has(config.cargos.socio)) return null; // só sócio ativo
  if (await repo.recentePorMembro(membro.id, new Date(Date.now() - R.JANELA_DUPLICADA_MS))) return null;

  const cargosAdv = config.cargos.adv;
  const atual = cargosAdv.findIndex(id => membro.roles.cache.has(id));
  const nivel = atual + 2; // atual = -1 (nenhuma) → 1ª
  if (nivel > cargosAdv.length) return null;
  const motivo = justificativa(registro);

  // Cargo primeiro: só registra depois de a ação ter funcionado
  if (atual >= 0) await membro.roles.remove(cargosAdv[atual]);
  await membro.roles.add(cargosAdv[nivel - 1]);
  if (nivel === 3) await membro.roles.remove(config.cargos.socio);

  const prazoEm = nivel === 2 ? new Date(Date.now() + R.PRAZO_PAGAMENTO_MS) : null;
  const linha = await repo.inserir({
    discordId: membro.id, idFivem: g.idFivem, nivel, origem: g.origem, motivo,
    registradoPor: registro.atorNome ?? null, logMessageId: registro.messageId,
    prazoEm, status: nivel === 3 ? 'CARGO_REMOVIDO' : 'ATIVA',
  });
  if (!linha) return null; // mesmo log reprocessado

  const base = campoMembro(membro, registro, g.origem);
  const quando = { name: 'DATA', value: `<t:${agoraSeg()}:F>`, inline: false };
  const mencoes = await mencoesDoSocio(membro.id);

  if (nivel === 1) {
    await enviar(guild, config.canais.historicoAdv, {
      color: tema.cor.perigo,
      title: '❌ 1ª ADVERTÊNCIA — AVISO FORMAL',
      fields: [...base, { name: 'JUSTIFICATIVA', value: motivo }, quando],
      footer: { text: 'Aviso formal. A próxima advertência exige pagamento; a terceira remove o cargo de sócio.' },
    }, mencoes);
  } else if (nivel === 2) {
    const exigido = Object.entries(R.PAGAMENTO_2A).map(([item, qtd]) => `${qtd} ${item}`).join(' + ');
    const expiraEm = Math.floor(prazoEm.getTime() / 1000);
    await enviar(guild, config.canais.advPendentes, {
      color: tema.cor.perigo,
      title: '❌ 2ª ADVERTÊNCIA — PAGAMENTO PENDENTE',
      fields: [
        ...base,
        { name: 'JUSTIFICATIVA', value: motivo },
        { name: 'PAGAMENTO', value: `${exigido} no baú da torcida`, inline: true },
        { name: 'PRAZO', value: `<t:${expiraEm}:F> (<t:${expiraEm}:R>)`, inline: true },
        quando,
      ],
      footer: { text: 'O depósito no baú é reconhecido pelo log do jogo. Sem pagamento no prazo, o cargo de sócio é removido.' },
    }, mencoes);
    try {
      await agendar('adv_vencimento', prazoEm, {
        variante: 'socio', advId: linha.id, membroId: membro.id, cargoAdv: cargosAdv[1], numAdv: 2,
        motivo, punicao: `Pagar ${exigido}`, prazoLabel: '2 DIAS', expiraEm,
      });
    } catch (err) {
      console.error('[adv-auto] Erro ao agendar vencimento:', err);
      await enviar(guild, config.canais.advPendentes, { color: tema.cor.perigo, title: '⚠️ VENCIMENTO NÃO AGENDADO', description: `Acompanhe manualmente o prazo de <@${membro.id}>.` }, mencoes);
    }
  } else {
    await enviar(guild, config.canais.historicoAdv, {
      color: tema.cor.perigo,
      title: '❌ 3ª ADVERTÊNCIA — CARGO DE SÓCIO REMOVIDO',
      fields: [...base, { name: 'JUSTIFICATIVA', value: motivo }, { name: 'AÇÃO', value: 'CARGO DE SÓCIO REMOVIDO', inline: false }, quando],
    }, mencoes);
  }
  return linha;
}

// Tira o cargo desta advertência e devolve o anterior (mesmo passo da remoção manual).
// Só mexe se o membro ainda está exatamente neste nível; se já subiu ou perdeu, só o registro muda.
async function baixarCargo(membro, nivel) {
  const cargosAdv = config.cargos.adv;
  if (!membro || nivel >= 3 || !membro.roles.cache.has(cargosAdv[nivel - 1])) return;
  await membro.roles.remove(cargosAdv[nivel - 1]);
  if (nivel > 1) await membro.roles.add(cargosAdv[nivel - 2]);
}

// ── Fechar (retirado no painel) ───────────────────────────────────────────
async function fechar(client, registro, g) {
  const linha = await repo.ativaPorIdFivem(g.idFivem, g.origem);
  if (!linha) return null;
  const { guild, membro } = await sociosPorIdFivem(client, g.idFivem);
  await baixarCargo(membro, linha.nivel);
  const fechada = await repo.encerrar(linha.id, 'REMOVIDA', `${ROTULO_ORIGEM[g.origem]} retirado no painel${registro.atorNome ? ` por ${registro.atorNome}` : ''}`);
  if (!fechada) return null;
  await enviar(guild, config.canais.historicoAdv, {
    color: tema.cor.primaria,
    title: `🦅 ${linha.nivel}ª ADVERTÊNCIA REMOVIDA`,
    fields: [
      { name: 'MEMBRO', value: `<@${linha.discord_id}>`, inline: true },
      { name: 'ID NO JOGO', value: `#${g.idFivem}`, inline: true },
      { name: 'MOTIVO', value: `${ROTULO_ORIGEM[g.origem]} retirado no painel do jogo${registro.atorNome ? ` por ${registro.atorNome}` : ''}.` },
      { name: 'DATA', value: `<t:${agoraSeg()}:F>`, inline: false },
    ],
  }, await mencoesDoSocio(linha.discord_id));
  return fechada;
}

// ── Pagamento (depósito no baú) ───────────────────────────────────────────
async function pagar(client, registro, item) {
  const idFivem = registro.atorIdFivem;
  for (const linha of await repo.pendentesDePagamento(idFivem)) {
    if (new Date(registro.ocorridoEm) < new Date(linha.criada_em)) continue; // depósito anterior à advertência
    if (new Date(registro.ocorridoEm) > new Date(linha.prazo_em)) continue;  // fora do prazo
    const { pago, falta, quitado } = R.aplicarPagamento(linha.pago ?? {}, item, registro.valor);
    await repo.gravarPagamento(linha.id, pago);
    if (!quitado) continue;

    const { guild, membro } = await sociosPorIdFivem(client, idFivem);
    await baixarCargo(membro, 2);
    const fechada = await repo.encerrar(linha.id, 'PAGA', `Pago no baú: ${Object.entries(pago).map(([i, q]) => `${q} ${i}`).join(', ')}`);
    if (!fechada) continue;
    await enviar(guild, config.canais.advPendentes, {
      color: tema.cor.primaria,
      title: '🦅 2ª ADVERTÊNCIA PAGA E REMOVIDA',
      fields: [
        { name: 'MEMBRO', value: `<@${linha.discord_id}>`, inline: true },
        { name: 'PAGO', value: Object.entries(pago).map(([i, q]) => `${q} ${i}`).join(' + '), inline: true },
        { name: 'DATA', value: `<t:${agoraSeg()}:F>`, inline: false },
      ],
    }, await mencoesDoSocio(linha.discord_id));
    return { linha: fechada, falta };
  }
  return null;
}

// Hook do pipeline de logs (manifesto `advertencia`, painelLog.aoRegistros)
async function aoRegistros(novos, client) {
  for (const registro of novos) {
    try {
      const g = R.gatilho(registro);
      if (g?.tipo === 'abrir') await abrir(client, registro, g);
      else if (g?.tipo === 'fechar') await fechar(client, registro, g);
      const item = R.itemDePagamento(registro);
      if (item) await pagar(client, registro, item);
    } catch (err) {
      console.error('[adv-auto] Erro ao processar registro:', err);
    }
  }
}

module.exports = { aoRegistros, abrir, fechar, pagar };
