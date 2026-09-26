// Inteligência do canal de advertências pendentes: cruza a advertência de sócio com
// o resto do que a torcida sabe da pessoa (ADV de recrutador, blacklist/suspensão/
// impedimento no jogo, lista "não recrutar", outros pagamentos pendentes).
// Nunca lança: contexto é bônus, não pode derrubar a advertência.
const config = require('../../config/index.js');
const repo = require('./repositorio');
const { mencoesDoSocio } = require('./mencoes');
const { enviarNoCanal } = require('./envio');

// Restrições ativas agora no jogo para o ID: ['BLACKLIST', ...]
async function restricoesAtivas(idFivem) {
  if (!idFivem) return [];
  const logs = require('../logsJogo/repositorio');
  const A = require('../logsJogo/analises');
  const eventos = await logs.eventosDoAlvo(idFivem, A.ACOES_RESTRICAO, 50);
  return A.statusRestricoesDoAlvo(eventos).filter(s => s.ativo).map(s => A.TIPOS_RESTRICAO[s.tipo].rotulo);
}

// ADV¹/²/³ do cargo de recrutador (só se o tenant configurou cargos.advRec)
function nivelAdvRecrutador(membro) {
  const cargos = config.cargos.advRec;
  if (!membro || !Array.isArray(cargos)) return null;
  const i = cargos.findIndex(id => id && membro.roles.cache.has(id));
  return i === -1 ? null : i + 1;
}

async function bloqueadoNaoRecrutar(client, idFivem) {
  if (!idFivem || !config.canais.historicoNaoRecrutar) return null;
  try {
    return Boolean(await require('../naoRecrutar').buscarBloqueio(client, idFivem));
  } catch {
    return null; // módulo/canal indisponível: não afirma nada
  }
}

const linhaPendente = p => `<@${p.discord_id}> · vence <t:${Math.floor(new Date(p.prazo_em).getTime() / 1000)}:R>`;

// Campos de embed com o cruzamento; só entram os que têm algo a dizer.
async function camposDeContexto(client, membro, idFivem) {
  const campos = [];
  try {
    const [restricoes, bloqueado, historico, todas] = await Promise.all([
      restricoesAtivas(idFivem).catch(() => null),
      bloqueadoNaoRecrutar(client, idFivem),
      repo.historicoDoMembro(membro.id),
      repo.pendentes(),
    ]);
    if (restricoes?.length) campos.push({ name: '🚫 RESTRIÇÕES ATIVAS NO JOGO', value: restricoes.join(' + '), inline: true });
    if (bloqueado) campos.push({ name: '🔒 NÃO RECRUTAR', value: 'ID já bloqueado', inline: true });
    const advRec = nivelAdvRecrutador(membro);
    if (advRec) campos.push({ name: '📋 ADV DE RECRUTADOR', value: `ATIVA — ${advRec}ª`, inline: true });
    const anteriores = historico.filter(h => h.status !== 'ATIVA');
    if (anteriores.length) {
      const por = anteriores.reduce((m, h) => ({ ...m, [h.status]: (m[h.status] ?? 0) + 1 }), {});
      campos.push({ name: '📜 HISTÓRICO DE ADV', value: Object.entries(por).map(([s, n]) => `${n} ${s.toLowerCase()}`).join(' · '), inline: false });
    }
    const outros = todas.filter(p => p.discord_id !== membro.id);
    if (outros.length) {
      campos.push({ name: `⏳ OUTROS PAGAMENTOS PENDENTES (${outros.length})`, value: outros.slice(0, 5).map(linhaPendente).join('\n'), inline: false });
    }
  } catch (err) {
    console.error('[adv] Erro ao montar contexto da advertência pendente:', err.message);
  }
  return campos;
}

// Reativo: restrição nova no jogo para quem está com pagamento pendente. Impedimento
// já abre a ADV seguinte sozinho (automatica.abrir); blacklist e suspensão não, e
// sem este aviso a liderança só descobriria pelo prazo vencendo.
const IDADE_MAX_MS = 6 * 60 * 60 * 1000;
const RESTRICOES_QUE_AVISAM =Object.freeze({ blacklist_adicionou: 'BLACKLIST', suspensao_adicionou: 'SUSPENSÃO' });

async function alertarRestricaoComPendencia(client, registro, guild, membro) {
  const rotulo = RESTRICOES_QUE_AVISAM[registro.acao];
  if (!rotulo || !registro.alvoIdFivem || !membro) return false;
  if (Date.now() - new Date(registro.ocorridoEm ?? Date.now()) > IDADE_MAX_MS) return false; // reprocessamento não realerta
  const pendentes = await repo.pendentes(membro.id);
  if (!pendentes.length) return false;
  const prazo = Math.floor(new Date(pendentes[0].prazo_em).getTime() / 1000);
  const tema = require('../../tema');
  return enviarNoCanal(guild, config.canais.advPendentes, {
    color: tema.cor.perigo,
    title: `🚨 ${rotulo} NO JOGO DURANTE PAGAMENTO PENDENTE`,
    description: (registro.descricao || 'Registro do jogo sem descrição.').slice(0, 900),
    fields: [
      { name: 'MEMBRO', value: `<@${membro.id}>`, inline: true },
      { name: 'ID NO JOGO', value: `#${registro.alvoIdFivem}`, inline: true },
      { name: '2ª ADV', value: `pagar até <t:${prazo}:F> (<t:${prazo}:R>)`, inline: false },
      ...(await camposDeContexto(client, membro, registro.alvoIdFivem)),
    ],
    footer: { text: 'Cruzamento automático: advertência pendente + restrição do jogo. A liderança decide.' },
  }, await mencoesDoSocio(membro.id));
}

module.exports = { camposDeContexto, alertarRestricaoComPendencia };
