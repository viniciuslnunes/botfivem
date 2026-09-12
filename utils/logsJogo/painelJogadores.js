const db = require('../db');
const config = require('../../config/index.js');
const { montarEmbedJogadoresOnline } = require('./relatorios');
const { linhaBotoesPresenca } = require('./presencaInteracoes');

// Painel fixo de jogadores online (quantos e quem, mais o pico de
// simultâneos por período), editado periodicamente. Estado recalculável:
// perder um ciclo num reinício não tem custo.
const CONFIG_KEY = 'painel_jogadores_message_id';

// Sócios (cargo Discord), pra bater com o painel do próprio jogo. Falha em
// buscar não derruba o painel — só sai sem esse número.
async function contarSocios(guild) {
  try {
    await guild.members.fetch();
    return guild.members.cache.filter(m => m.roles.cache.has(config.cargos.socio)).size;
  } catch (err) {
    console.error('[painel-jogadores] Erro ao contar sócios:', err);
    return null;
  }
}

async function atualizarPainelJogadores(client) {
  const canal = await client.channels.fetch(config.logsJogo.canalPainelJogadores).catch(() => null);
  if (!canal) return;

  const sociosCount = await contarSocios(canal.guild);
  const embed = await montarEmbedJogadoresOnline(sociosCount);
  const components = linhaBotoesPresenca();
  const res = await db.query('SELECT value FROM bot_config WHERE key = $1', [CONFIG_KEY]);
  const messageId = res.rows[0]?.value;

  if (messageId) {
    try {
      const msg = await canal.messages.fetch(messageId);
      await msg.edit({ embeds: [embed], components, allowedMentions: { parse: [] } });
      return;
    } catch {
      // mensagem apagada — recriar
    }
  }
  const nova = await canal.send({ embeds: [embed], components, allowedMentions: { parse: [] } });
  await db.query(
    'INSERT INTO bot_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
    [CONFIG_KEY, nova.id]
  );
}

function iniciarPainelJogadores(client) {
  if (!config.logsJogo.canalPainelJogadores) return;
  const atualizar = () => atualizarPainelJogadores(client).catch(err => console.error('[painel-jogadores] Erro ao atualizar:', err));
  atualizar();
  // O ciclo por tempo fica só como rede de segurança: a atualização de
  // verdade é reativa (agendarAtualizacaoReativa), disparada a cada
  // entrada/saída que chega.
  setInterval(atualizar, config.logsJogo.painelJogadoresIntervaloMin * 60 * 1000);
}

// Atualização reativa: dispara pouco depois de um evento de entrada/saída
// chegar, em vez de esperar o próximo ciclo de tempo. Junta várias entradas/
// saídas que cheguem em sequência (comum quando vários jogadores conectam
// juntos) numa única atualização, pra não estourar o rate limit de edição de
// mensagem do Discord.
const DEBOUNCE_MS = 15 * 1000;
let timerPendente = null;

function agendarAtualizacaoReativa(client) {
  if (!config.logsJogo.canalPainelJogadores || timerPendente) return;
  timerPendente = setTimeout(() => {
    timerPendente = null;
    atualizarPainelJogadores(client).catch(err => console.error('[painel-jogadores] Erro ao atualizar (reativo):', err));
  }, DEBOUNCE_MS);
}

module.exports = { atualizarPainelJogadores, iniciarPainelJogadores, agendarAtualizacaoReativa };
