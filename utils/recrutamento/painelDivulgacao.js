const { PermissionFlagsBits: P } = require('discord.js');
const config = require('../../config/index.js');
const tema = require('../../tema');
const { garantirMembrosCarregados } = require('../membrosGuild');
const { criarPainelCanal } = require('../logsJogo/painelCanal');
const F = require('../logsJogo/painelFormato');
const E = require('../logsJogo/estatisticas');
const repo = require('./divulgacaoRepositorio');
const { montarSequencia, contarPorAutor, analisarRodizio, semLiberacao } = require('./divulgacaoRegras');

// Canal de divulgação de recrutamento (canais.divulgacaoRecrutamento): o bot
// registra quem postou e quando, e o canal-painel só da liderança
// (📣・sequência-recrutamento) mostra quem tem liberação de postar, a sequência
// dos últimos posts e o rodízio. canais.divulgacaoRecrutamento null = desligado.
const SLUG = 'sequencia_recrutamento';
const LINHAS_SEQUENCIA = 15;
const DIAS_SUMIDO = 7;

let clientAtual = null;

function canalDivulgacaoId() {
  return config.canais.divulgacaoRecrutamento ?? null;
}

// Post novo no canal → registra. Nunca consome a mensagem.
async function aoMensagem(message) {
  if (!canalDivulgacaoId() || message.channelId !== canalDivulgacaoId() || message.author?.bot) return false;
  try {
    await repo.registrarPost({ messageId: message.id, autorId: message.author.id, postadoEm: message.createdAt });
    const client = clientAtual ?? message.client;
    if (client) painel.agendarAtualizacaoReativa(client);
  } catch (err) {
    console.error('[divulgacao] Erro ao registrar post:', err);
  }
  return false;
}

// Histórico que já existia antes do recurso: lê as últimas mensagens do canal.
async function importarHistorico(client) {
  const canal = await client.channels.fetch(canalDivulgacaoId()).catch(() => null);
  if (!canal?.messages?.fetch) return;
  const recentes = await canal.messages.fetch({ limit: 100 });
  for (const m of recentes.values()) {
    if (m.author?.bot) continue;
    await repo.registrarPost({ messageId: m.id, autorId: m.author.id, postadoEm: m.createdAt });
  }
}

// Quem pode mandar mensagem no canal (permissão real do Discord, com cargos e
// overrides do canal). Separa recrutadores (entram no rodízio) dos demais.
async function quemPodePostar(client) {
  const guild = await client.guilds.fetch(config.guildId);
  await garantirMembrosCarregados(guild);
  const canal = await client.channels.fetch(canalDivulgacaoId());
  const humanos = [...guild.members.cache.values()].filter(m => !m.user?.bot);
  const podem = humanos.filter(m => canal.permissionsFor(m)?.has(P.SendMessages));
  const ehRec = m => m.roles.cache.has(config.cargos.recrutador);
  return {
    recrutadoresLiberados: podem.filter(ehRec).map(m => m.id),
    outrosLiberados: podem.filter(m => !ehRec(m)).map(m => m.id),
    recrutadoresSemLiberacao: humanos.filter(m => ehRec(m) && !podem.includes(m)).map(m => m.id),
  };
}

const MAX_MENCOES = 40;
const mencoes = ids => (ids.length
  ? ids.slice(0, MAX_MENCOES).map(id => `<@${id}>`).join(' · ') + (ids.length > MAX_MENCOES ? ` …+${ids.length - MAX_MENCOES}` : '')
  : '—');

function linhaSequencia(p, ordem) {
  const ts = Math.floor(p.postadoEm.getTime() / 1000);
  const intervalo = p.intervaloMs === null ? '' : ` · +${E.formatarDuracao(p.intervaloMs)} após o anterior`;
  return `${ordem}. <@${p.autorId}> — <t:${ts}:f> (<t:${ts}:R>)${intervalo}`;
}

async function montarBlocos() {
  if (!canalDivulgacaoId()) {
    return F.blocosDeEmbeds(F.embedsDeLista({
      titulo: '📣 SEQUÊNCIA DE RECRUTAMENTO', linhas: [], vazio: 'Canal de divulgação não configurado (canais.divulgacaoRecrutamento).',
      fonte: 'Configuração do tenant',
    }));
  }
  const [posts, acesso] = await Promise.all([repo.ultimosPosts(200), quemPodePostar(clientAtual)]);
  const rodizio = analisarRodizio({ liberados: acesso.recrutadoresLiberados, posts, diasSumido: DIAS_SUMIDO });
  const sequencia = montarSequencia(posts).slice(0, LINHAS_SEQUENCIA);
  const contagem = contarPorAutor(posts);

  const alertas = [];
  if (rodizio.repetiuSeguido) alertas.push(`${tema.emoji.aviso} <@${rodizio.repetiuSeguido}> postou **duas vezes seguidas** — passa a vez.`);
  if (rodizio.sumidos.length) {
    alertas.push(`${tema.emoji.aviso} Liberados **sem postar há mais de ${DIAS_SUMIDO} dias** (ou nunca): ${mencoes(rodizio.sumidos)}`);
  }
  const fantasmas = semLiberacao(posts.slice(0, LINHAS_SEQUENCIA), [...acesso.recrutadoresLiberados, ...acesso.outrosLiberados]);
  if (fantasmas.length) alertas.push(`${tema.emoji.aviso} Postaram recentemente mas **já não têm liberação**: ${mencoes(fantasmas)}`);

  const liberacao = [
    `**Recrutadores liberados (${acesso.recrutadoresLiberados.length}):** ${mencoes(acesso.recrutadoresLiberados)}`,
    `**Recrutadores SEM liberação (${acesso.recrutadoresSemLiberacao.length}):** ${mencoes(acesso.recrutadoresSemLiberacao)}`,
    `**Outros com liberação (liderança/administração):** ${mencoes(acesso.outrosLiberados)}`,
  ];
  const vez = rodizio.proximo ? `<@${rodizio.proximo}>` : '—';
  const contagemLinhas = acesso.recrutadoresLiberados
    .map(id => `• <@${id}> — **${contagem.get(id) ?? 0}** posts (últimos 200)`);

  return F.blocosDeEmbeds(F.embedsDeLista({
    titulo: '📣 SEQUÊNCIA DE RECRUTAMENTO',
    cabecalho: `Canal: <#${canalDivulgacaoId()}>\n**Próximo da vez:** ${vez}\n`
      + `${alertas.length ? `\n${alertas.join('\n')}\n` : ''}\n${liberacao.join('\n')}\n\n**Posts por recrutador**\n${contagemLinhas.join('\n') || '—'}\n\n**Últimos posts (mais recente primeiro)**`,
    linhas: sequencia.map((p, i) => linhaSequencia(p, i + 1)),
    vazio: 'Nenhum post de divulgação registrado ainda.',
    fonte: 'Posts registrados no canal de divulgação · liberação = permissão de enviar mensagem no canal',
  }));
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '📣・sequência-recrutamento',
  razao: 'Quem pode divulgar recrutamento e a sequência dos posts',
  intervaloMin: 60,
  debounceMs: 5 * 1000,
  canalVizinhoId: canalDivulgacaoId(),
  montarBlocos,
});

async function iniciarPainelDivulgacao(client) {
  clientAtual = client;
  if (!canalDivulgacaoId()) return;
  await importarHistorico(client).catch(err => console.error('[divulgacao] Erro ao importar histórico:', err));
  painel.iniciar(client);
}

module.exports = { iniciarPainelDivulgacao, aoMensagem, quemPodePostar, atualizarPainel: client => { clientAtual = client; return painel.atualizar(client); } };
