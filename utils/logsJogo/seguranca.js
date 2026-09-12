const { EmbedBuilder } = require('discord.js');
const config = require('../../config/index.js');
const { lerConfig, gravarConfig } = require('../botConfig');
const repo = require('./repositorio');
const P = require('./presenca');

// Segurança do patrimônio (sede/portão), a partir dos eventos que o parser
// já reconhece (sede_trancou/destrancou, portao_trancou/destrancou — ver
// parser.js). Sem tabela nova: o estado de cada fechadura é só "qual desses
// dois eventos aconteceu por último", recalculado a cada checagem.
const LIMITE_SESSAO_MS = config.logsJogo.presencaSessaoMaxHoras * 60 * 60 * 1000;
const CONFIG_KEY_ESTADO_ALERTAS = 'seguranca_alertas_estado';

const FECHADURAS = [
  { chave: 'sede', rotulo: 'SEDE', artigo: 'a', trancou: 'sede_trancou', destrancou: 'sede_destrancou' },
  { chave: 'portao', rotulo: 'PORTÃO', artigo: 'o', trancou: 'portao_trancou', destrancou: 'portao_destrancou' },
];

async function estadoFechadura(f) {
  const ultimo = await repo.ultimoEvento([f.trancou, f.destrancou]);
  if (!ultimo) return { ...f, aberta: null, desde: null, por: null };
  return {
    ...f,
    aberta: ultimo.acao === f.destrancou,
    desde: new Date(ultimo.ocorrido_em),
    por: ultimo.ator_nome,
  };
}

// Estado das duas fechaduras agora — usado tanto pelo checador de alerta
// quanto por quem quiser exibir "sede destrancada desde tal hora" em algum
// painel/comando.
async function estadoFechaduras() {
  return Promise.all(FECHADURAS.map(estadoFechadura));
}

async function ninguemOnline(agora) {
  const estado = P.estadoSemSessoesExpiradas(await repo.estadoDosJogadores(agora), LIMITE_SESSAO_MS, agora);
  return P.totalOnline(estado) === 0;
}

async function lerEstadoAlertas() {
  try {
    const bruto = await lerConfig(CONFIG_KEY_ESTADO_ALERTAS);
    return bruto ? JSON.parse(bruto) : {};
  } catch (err) {
    console.error('[seguranca] Erro ao ler estado de alertas:', err);
    return {};
  }
}

function mencoes() {
  return config.logsJogo.mencionarAlertas.map(id => `<@&${id}>`).join(' ');
}

function embedAlerta(f) {
  return new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle(`🔓 ${f.rotulo} DESTRANCAD${f.artigo === 'a' ? 'A' : 'O'} SEM NINGUÉM NO SERVIDOR`)
    .setDescription(
      `${f.artigo === 'a' ? 'A' : 'O'} ${f.rotulo.toLowerCase()} está destrancad${f.artigo === 'a' ? 'a' : 'o'} desde ` +
      `<t:${Math.floor(f.desde.getTime() / 1000)}:R> (${f.por ?? 'alguém'}) e não tem ninguém online no jogo agora.\n` +
      `Risco de furto no patrimônio — só destrancar/trancar de novo resolve o alerta.`
    )
    .setFooter({ text: 'Detectado automaticamente pelos logs do jogo (canal logs-painel)' })
    .setTimestamp();
}

// Checagem periódica: fechadura destrancada + tempo acima do limite +
// ninguém online no jogo nesse instante = alerta no canal já usado pelos
// outros alertas de logs-jogo (config.logsJogo.canalAlertas). Reenvia depois
// de `repetirAlertaMin` enquanto continuar destrancada — pra não deixar
// escapar quando o primeiro aviso passa despercebido, mas sem spam a cada
// ciclo de 10min. Fecha (tranca de novo) e o alerta some sozinho.
async function verificarSeguranca(client) {
  const canal = await client.channels.fetch(config.logsJogo.canalAlertas).catch(() => null);
  if (!canal) return;

  const agora = new Date();
  const [fechaduras, semNinguemOnline] = await Promise.all([estadoFechaduras(), ninguemOnline(agora)]);
  const estadoAlertas = await lerEstadoAlertas();
  let mudou = false;
  const limiteMs = config.logsJogo.seguranca.limiteDestrancadaMin * 60 * 1000;
  const cooldownMs = config.logsJogo.seguranca.repetirAlertaMin * 60 * 1000;

  for (const f of fechaduras) {
    if (!f.aberta || !f.desde) {
      if (estadoAlertas[f.chave]) { delete estadoAlertas[f.chave]; mudou = true; }
      continue;
    }
    const abertaHaMs = agora.getTime() - f.desde.getTime();
    if (abertaHaMs < limiteMs || !semNinguemOnline) continue;

    const ultimoAlertaEm = estadoAlertas[f.chave];
    if (ultimoAlertaEm && agora.getTime() - ultimoAlertaEm < cooldownMs) continue;

    await canal.send({ content: mencoes(), embeds: [embedAlerta(f)] }).catch(err =>
      console.error(`[seguranca] Erro ao enviar alerta de ${f.chave}:`, err));
    estadoAlertas[f.chave] = agora.getTime();
    mudou = true;
  }

  if (mudou) await gravarConfig(CONFIG_KEY_ESTADO_ALERTAS, JSON.stringify(estadoAlertas));
}

function iniciarVerificacaoSeguranca(client) {
  const verificar = () => verificarSeguranca(client).catch(err => console.error('[seguranca] Erro ao verificar:', err));
  setTimeout(verificar, 60 * 1000);
  setInterval(verificar, config.logsJogo.seguranca.verificarIntervaloMin * 60 * 1000);
}

// Embed "estado atual", reaproveitável pelo comando sob demanda.
function embedEstadoAtual(fechaduras) {
  const linhas = fechaduras.map(f => {
    if (f.aberta === null) return `**${f.rotulo}**: sem registro nos logs ainda`;
    const status = f.aberta ? '🔓 destrancada' : '🔒 trancada';
    const desde = `<t:${Math.floor(f.desde.getTime() / 1000)}:R>`;
    return `**${f.rotulo}**: ${status} ${desde} — ${f.por ?? '?'}`;
  });
  return new EmbedBuilder()
    .setColor(0x000000)
    .setTitle('🔐 SEGURANÇA DO PATRIMÔNIO')
    .setDescription(linhas.join('\n'))
    .setFooter({ text: 'Com base nos logs do jogo recebidos pelo webhook · canal logs-painel' })
    .setTimestamp();
}

module.exports = {
  estadoFechaduras,
  verificarSeguranca,
  iniciarVerificacaoSeguranca,
  embedEstadoAtual,
};
