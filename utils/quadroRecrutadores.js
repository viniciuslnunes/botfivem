const db = require('./db');
const config = require('../config/index.js');
const tema = require('../tema');
const E = require('./logsJogo/estatisticas');
const repoLogs = require('./logsJogo/repositorio');

const CANAL_QUADRO = config.canais.quadroRecrutadores;
const CONFIG_KEY = 'quadro_recrutadores_message_id';
const CARGO_RECRUTADOR = config.cargos.recrutador;

async function getQuadroMessageId() {
  const res = await db.query('SELECT value FROM bot_config WHERE key = $1', [CONFIG_KEY]);
  return res.rows.length > 0 ? res.rows[0].value : null;
}

async function setQuadroMessageId(id) {
  await db.query(
    'INSERT INTO bot_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
    [CONFIG_KEY, id]
  );
}

async function registrarEntradaNoCargo(discordId) {
  await db.query(
    'INSERT INTO recrutadores_cargo (discord_id) VALUES ($1) ON CONFLICT (discord_id) DO NOTHING',
    [discordId]
  );
}

async function removerEntradaNoCargo(discordId) {
  await db.query('DELETE FROM recrutadores_cargo WHERE discord_id = $1', [discordId]);
}

// Data por Discord ID. A fonte é a promoção a Recrutador logada pelo jogo
// (ID do jogo no apelido); quem não tem ID no apelido ou promoção nos logs
// cai no registro do momento em que o cargo do Discord foi dado.
async function carregarDesde(membros) {
  const desde = new Map();
  try {
    const res = await db.query('SELECT discord_id, desde FROM recrutadores_cargo');
    for (const r of res.rows) desde.set(r.discord_id, new Date(r.desde));
  } catch (err) {
    console.error('[quadroRecrutadores] Erro ao ler datas do cargo:', err.message);
  }
  try {
    const idsFivem = new Map(membros.map(m => [m.id, E.idFivemDoNick(m.nickname ?? m.displayName)]));
    const promocoes = await repoLogs.ultimaPromocaoParaRecrutador([...new Set([...idsFivem.values()].filter(Boolean))]);
    const porIdFivem = new Map(promocoes.map(p => [p.id, new Date(p.desde)]));
    for (const [discordId, idFivem] of idsFivem) {
      if (idFivem && porIdFivem.has(idFivem)) desde.set(discordId, porIdFivem.get(idFivem));
    }
  } catch (err) {
    console.error('[quadroRecrutadores] Erro ao ler promoções do jogo:', err.message);
  }
  return desde;
}

// Só há data para quem ganhou o cargo depois que o registro existe.
function linhaDoRecrutador(id, desde) {
  if (!desde) return `<@${id}>`;
  const ts = Math.floor(desde.getTime() / 1000);
  return `<@${id}> · no DP desde <t:${ts}:d> (<t:${ts}:R>)`;
}

function construirEmbed(guild, desdePorId = new Map()) {
  const membros = guild.members.cache.filter(m => m.roles.cache.has(CARGO_RECRUTADOR));

  let descricao = '';
  membros.forEach(m => {
    descricao += `${linhaDoRecrutador(m.id, desdePorId.get(m.id))}\n`;
  });

  if (!descricao) descricao = '*NENHUM RECRUTADOR REGISTRADO.*';

  if (descricao.length > 4096) descricao = descricao.substring(0, 4093) + '...';

  return {
    color: tema.cor.primaria,
    title: tema.titulo('📋 QUADRO DE RECRUTADORES'),
    description: descricao,
    thumbnail: { url: tema.urlLogo() },
    footer: { text: `TOTAL: ${membros.size} RECRUTADOR${membros.size !== 1 ? 'ES' : ''}` },
    timestamp: new Date().toISOString(),
  };
}

// ── Gestores: quem promoveu/rebaixou e as pessoas de cada um ──────────────────
const CHAVE_EXTRAS = 'quadro_recrutadores_extras_message_ids';
const LIMITE_EMBED = 3800;

// `quem` vira menção quando o ID do jogo bate com o apelido de alguém no Discord;
// sem vínculo, fica nome e ID do jogo.
function rotuloDePessoa(nome, idFivem, membroPorIdFivem) {
  const membro = idFivem ? membroPorIdFivem.get(idFivem) : null;
  if (membro) return `<@${membro.id}>`;
  return nome ? `**${nome}**${idFivem ? ` \`${idFivem}\`` : ''}` : `\`${idFivem ?? '?'}\``;
}

// Agrupa por gestor (quem fez o movimento): mais pessoas primeiro, e dentro do
// grupo o movimento mais recente primeiro. Devolve blocos de texto prontos.
function blocosPorGestor(movimentos, membroPorIdFivem) {
  const grupos = new Map();
  for (const m of movimentos) {
    const chave = m.ator_id_fivem ?? m.ator_nome ?? '?';
    if (!grupos.has(chave)) grupos.set(chave, { gestor: rotuloDePessoa(m.ator_nome, m.ator_id_fivem, membroPorIdFivem), itens: [] });
    grupos.get(chave).itens.push(m);
  }
  return [...grupos.values()]
    .sort((a, b) => b.itens.length - a.itens.length)
    .map(({ gestor, itens }) => {
      const linhas = itens
        .sort((a, b) => new Date(b.ocorrido_em) - new Date(a.ocorrido_em))
        .map(m => {
          const ts = Math.floor(new Date(m.ocorrido_em).getTime() / 1000);
          return `↳ ${rotuloDePessoa(m.alvo_nome, m.alvo_id_fivem, membroPorIdFivem)} · <t:${ts}:d> (<t:${ts}:R>)`;
        });
      return `**Gestor:** ${gestor} · ${itens.length}\n${linhas.join('\n')}`;
    });
}

// Junta blocos em descrições que cabem num embed (os grupos não se partem no meio).
function paginar(blocos) {
  const paginas = [];
  let atual = '';
  for (const b of blocos) {
    if (atual && atual.length + b.length + 2 > LIMITE_EMBED) { paginas.push(atual); atual = ''; }
    atual += (atual ? '\n\n' : '') + b;
  }
  if (atual) paginas.push(atual);
  return paginas;
}

function embedsDeGestores(movimentos, membroPorIdFivem) {
  const secoes = [
    { acao: 'promoveu_cargo', titulo: '🧭 PROMOVIDOS A RECRUTADOR, POR GESTOR', vazio: 'Nenhuma promoção a recrutador nos logs.', rodape: 'promovidos' },
    { acao: 'rebaixou_cargo', titulo: '⬇️ REBAIXADOS DE RECRUTADOR PARA SÓCIO, POR GESTOR', vazio: 'Nenhum rebaixamento de recrutador nos logs.', rodape: 'rebaixados' },
  ];
  return secoes.flatMap(s => {
    const itens = movimentos.filter(m => m.acao === s.acao);
    const paginas = paginar(blocosPorGestor(itens, membroPorIdFivem));
    const rodape = `TOTAL: ${itens.length} ${s.rodape.toUpperCase()} · logs do jogo`;
    if (!paginas.length) return [{ color: tema.cor.primaria, title: tema.titulo(s.titulo), description: `*${s.vazio}*`, footer: { text: rodape }, timestamp: new Date().toISOString() }];
    return paginas.map((descricao, i) => ({
      color: tema.cor.primaria,
      title: i === 0 ? tema.titulo(s.titulo) : null,
      description: descricao,
      footer: { text: rodape + (paginas.length > 1 ? ` · Página ${i + 1}/${paginas.length}` : '') },
      timestamp: new Date().toISOString(),
    }));
  });
}

// Mensagens extras do canal: reedita no lugar, cria as que faltam e apaga as que sobram.
async function atualizarGestores(canal, guild, recriar = false) {
  const movimentos = await repoLogs.movimentosDeRecrutador();
  const membroPorIdFivem = new Map();
  for (const m of guild.members.cache.values()) {
    const id = E.idFivemDoNick(m.nickname ?? m.displayName);
    if (id) membroPorIdFivem.set(id, m);
  }
  const embeds = embedsDeGestores(movimentos, membroPorIdFivem);

  let antigos;
  try {
    const bruto = await db.query('SELECT value FROM bot_config WHERE key = $1', [CHAVE_EXTRAS]);
    antigos = bruto.rows.length ? JSON.parse(bruto.rows[0].value) : [];
  } catch { antigos = []; }
  if (recriar) {
    for (const id of antigos) await canal.messages.delete(id).catch(() => {});
    antigos = [];
  }

  const novos = [];
  for (let i = 0; i < embeds.length; i++) {
    const payload = { embeds: [embeds[i]], allowedMentions: { users: [] } };
    const existente = antigos[i] ? await canal.messages.fetch(antigos[i]).catch(() => null) : null;
    novos.push(existente ? (await existente.edit(payload)).id : (await canal.send(payload)).id);
  }
  for (const id of antigos.slice(embeds.length)) await canal.messages.delete(id).catch(() => {});
  await db.query(
    'INSERT INTO bot_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
    [CHAVE_EXTRAS, JSON.stringify(novos)]
  );
}

async function atualizarQuadroRecrutadores(client) {
  try {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    await guild.members.fetch({ withPresences: false, force: true }).catch(() => {});

    const recrutadores = [...guild.members.cache.filter(m => m.roles.cache.has(CARGO_RECRUTADOR)).values()];
    const embed = construirEmbed(guild, await carregarDesde(recrutadores));
    const canal = await client.channels.fetch(CANAL_QUADRO);
    if (!canal) return;

    const messageId = await getQuadroMessageId();

    let recriou = true;

    if (messageId) {
      try {
        const msg = await canal.messages.fetch(messageId);
        await msg.edit({
          embeds: [embed],
          files: [tema.logo()],
          allowedMentions: { users: [] },
        });
        recriou = false;
      } catch {
        // mensagem deletada — recriar
      }
    }

    if (recriou) {
      const sent = await canal.send({
        embeds: [embed],
        files: [tema.logo()],
        allowedMentions: { users: [] },
      });
      await setQuadroMessageId(sent.id);
    }

    // Os gestores ficam sempre abaixo do quadro: se o quadro nasceu de novo, eles também.
    await atualizarGestores(canal, guild, recriou)
      .catch(err => console.error('[quadroRecrutadores] Erro ao atualizar gestores:', err));
  } catch (err) {
    console.error('[quadroRecrutadores] Erro ao atualizar:', err);
  }
}

module.exports = {
  atualizarQuadroRecrutadores, blocosPorGestor, embedsDeGestores, registrarEntradaNoCargo, removerEntradaNoCargo, CARGO_RECRUTADOR,
};
