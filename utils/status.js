// /status: o bot está de pé e saudável? Mostra o que a liderança precisa para
// saber se algo parou: banco, fila de tarefas, módulos e cada fonte de log.
// `montarStatus` é puro (recebe os números); `coletarStatus` fala com o banco.
const tema = require('../tema');

const MS_DIA = 24 * 60 * 60 * 1000;

function duracao(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}min`;
  return `${m}min`;
}

function idade(ultima, agora) {
  if (!ultima) return null;
  return agora - new Date(ultima).getTime();
}

// dados: { tenant, plataforma, uptimeSeg, versao, banco: { ok, ms, erro }, tarefas: { pendente, executando, erro },
//          logs: null | [{ nome, ultima }], fonteParadaDias, agora }
function montarStatus(dados) {
  const { tenant, plataforma, uptimeSeg, versao, banco, tarefas, logs, fonteParadaDias, agora = Date.now() } = dados;
  const ok = tema.emoji.ok;
  const ruim = tema.emoji.recusado;
  const aviso = tema.emoji.aviso;
  let problemas = 0;
  const linhas = [];

  linhas.push(`**TENANT:** \`${tenant.slug}\` · **VERSÃO:** ${versao} · **NO AR HÁ:** ${duracao(uptimeSeg * 1000)}`);
  linhas.push(`**MÓDULOS:** ${plataforma.ativos.length} ligados${plataforma.desligados.length ? `, ${plataforma.desligados.length} desligados` : ''}`);

  linhas.push('', '**BANCO DE DADOS**');
  if (banco.ok) linhas.push(`${ok} respondendo (${banco.ms} ms)`);
  else { problemas++; linhas.push(`${ruim} sem resposta — ${banco.erro}`); }

  linhas.push('', '**TAREFAS AGENDADAS**');
  if (tarefas) {
    linhas.push(`${ok} ${tarefas.pendente ?? 0} pendente(s), ${tarefas.executando ?? 0} executando`);
    if (tarefas.erro) { problemas++; linhas.push(`${ruim} ${tarefas.erro} tarefa(s) desistiram depois de várias tentativas`); }
  } else {
    linhas.push(`${aviso} indisponível`);
  }

  if (logs) {
    linhas.push('', '**FONTES DE LOG**');
    if (!logs.length) linhas.push(`${aviso} nenhum canal de log configurado`);
    for (const l of logs) {
      const ms = idade(l.ultima, agora);
      if (ms === null) { problemas++; linhas.push(`${ruim} #${l.nome} — nunca recebeu log`); }
      else if (ms > fonteParadaDias * MS_DIA) { problemas++; linhas.push(`${ruim} #${l.nome} — parado há ${duracao(ms)} (limite: ${fonteParadaDias} dias)`); }
      else linhas.push(`${ok} #${l.nome} — último log há ${duracao(ms)}`);
    }
  }
  return { linhas, problemas };
}

async function coletarStatus({ tenant, plataforma, versao }) {
  const db = require('./db');

  const t0 = Date.now();
  const banco = await db.query('SELECT 1').then(() => ({ ok: true, ms: Date.now() - t0 }), err => ({ ok: false, erro: err.message }));

  let tarefas = null;
  let logs = null;
  if (banco.ok) {
    const contagem = await db.query('SELECT status, COUNT(*)::int AS n FROM tarefas_agendadas GROUP BY status').catch(() => null);
    if (contagem) tarefas = Object.fromEntries(contagem.rows.map(r => [r.status, r.n]));

    if (plataforma.idsAtivos.has('logsJogo')) {
      const repo = require('./logsJogo/repositorio');
      const ultimas = await repo.ultimaOcorrenciaPorCanal().catch(() => new Map());
      logs = tenant.logsJogo.canais.map(id => ({ nome: tenant.logsJogo.nomesCanais?.[id] ?? id, ultima: ultimas.get(id) ?? null }));
    }
  }
  return {
    tenant, plataforma, versao, banco, tarefas, logs,
    uptimeSeg: process.uptime(),
    fonteParadaDias: tenant.logsJogo?.fonteParadaDias ?? 3,
    agora: Date.now(),
  };
}

module.exports = { montarStatus, coletarStatus, duracao };
