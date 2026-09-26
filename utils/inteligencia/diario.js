// Resumo diário da liderança: só o que pede ação nas próximas horas (pagamento vencendo, caso parado,
// sócio de risco alto). Sem nada a dizer, não publica: a semana já tem o boletim, o dia só fala se importa.
// Marca em `bot_config` `resumo_diario_inteligencia_ultimo` (dia, no fuso da torcida) sobrevive a reinício.
const config = require('../../config/index.js');
const tema = require('../../tema');
const { lerConfig, gravarConfig } = require('../botConfig');
const R = require('./regras');
const casos = require('./casos');
const repo = require('./repositorio');
const { garantirCanalInteligencia, mencoesLideranca } = require('./canais');

const CHAVE_ULTIMO = 'resumo_diario_inteligencia_ultimo';
const HORA_PUBLICACAO = 9;
const FUSO = 'America/Sao_Paulo';
const RISCO_ALTO = 60;
const seg = data => Math.floor(new Date(data).getTime() / 1000);

function diaEHoraLocal(agora) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(agora).map(p => [p.type, p.value]));
  return { dia: `${partes.year}-${partes.month}-${partes.day}`, hora: Number(partes.hour) };
}

// Linhas do resumo (vazio = nada a publicar)
async function montarLinhas(agora = new Date()) {
  const linhas = [];
  const vencendo = (await require('../advertencia/repositorio').pendentes())
    .filter(p => new Date(p.prazo_em) - agora <= R.DIA_MS);
  if (vencendo.length) {
    linhas.push(`**⏳ Pagamentos que vencem em 24 h (${vencendo.length}):**`,
      ...vencendo.slice(0, 8).map(p => `> <@${p.discord_id}> · vence <t:${seg(p.prazo_em)}:R>`));
  }
  const parados = (await casos.abertos()).filter(c => agora - new Date(c.aberto_em) > R.DIA_MS);
  if (parados.length) {
    const porTipo = parados.reduce((m, c) => m.set(c.tipo, (m.get(c.tipo) ?? 0) + 1), new Map());
    linhas.push(`**📌 Casos abertos há mais de 24 h (${parados.length}):**`,
      ...[...porTipo].map(([tipo, n]) => `> ${casos.ROTULOS[tipo] ?? tipo}: ${n}`));
  }
  const altos = (await repo.maioresRiscos(5, RISCO_ALTO)).filter(r => r.risco >= RISCO_ALTO);
  if (altos.length) {
    linhas.push(`**🔥 Risco alto (${RISCO_ALTO}+):**`,
      ...altos.map(r => `> <@${r.discord_id}> · risco ${r.risco}${r.dados?.fatores?.length ? ` — ${r.dados.fatores.slice(0, 2).join(' · ')}` : ''}`));
  }
  return linhas;
}

async function publicarResumoDiario(client, agora = new Date()) {
  const linhas = await montarLinhas(agora);
  if (!linhas.length) return false;
  const canal = await garantirCanalInteligencia(client);
  await canal.send({
    content: mencoesLideranca(),
    allowedMentions: { roles: config.lideranca.filter(Boolean), users: [] },
    embeds: [{
      color: tema.cor.aviso,
      title: '☀️ RESUMO DO DIA — O QUE PEDE AÇÃO',
      description: linhas.join('\n').slice(0, 4000),
      footer: { text: 'Resumo diário · só informa · o boletim completo sai toda semana' },
      timestamp: agora.toISOString(),
    }],
  });
  return true;
}

// Publica uma vez por dia, a partir das 9 h (horário de Brasília). Marca o dia antes: falha não repete em loop.
async function publicarSeDeveria(client, agora = new Date()) {
  const { dia, hora } = diaEHoraLocal(agora);
  if (hora < HORA_PUBLICACAO || (await lerConfig(CHAVE_ULTIMO)) === dia) return false;
  await gravarConfig(CHAVE_ULTIMO, dia);
  return publicarResumoDiario(client, agora);
}

let timer = null;
function iniciar(client) {
  const rodar = () => publicarSeDeveria(client).catch(err => console.error('[inteligencia] Resumo diário falhou:', err));
  setTimeout(rodar, 15 * 60 * 1000).unref();
  timer = setInterval(rodar, R.HORA_MS);
  timer.unref();
}

module.exports = { montarLinhas, publicarResumoDiario, publicarSeDeveria, diaEHoraLocal, iniciar };
