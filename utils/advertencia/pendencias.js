// Pagamentos pendentes de 2ª advertência de sócio: lembrete antes do prazo, painel vivo e aviso de
// que a pendência mudou (paga, vencida, removida) para quem reage (inteligência fecha os casos).
// O canal `advPendentes` segue sendo o histórico de eventos; o painel é a fila de agora.
const config = require('../../config/index.js');
const tema = require('../../tema');
const { agendar, registrarTipo } = require('../agendador');
const { criarPainelCanal } = require('../logsJogo/painelCanal');
const F = require('../logsJogo/painelFormato');
const barramento = require('../barramento');
const R = require('./automaticaRegras');
const repo = require('./repositorio');
const { mencoesDoSocio } = require('./mencoes');
const { enviarNoCanal } = require('./envio');

const TIPO_LEMBRETE = 'adv_lembrete_prazo';
const ANTECEDENCIA_MS = 12 * 60 * 60 * 1000;
const ts = data => Math.floor(new Date(data).getTime() / 1000);

// O que ainda falta pagar, em texto ("30 maconha + 50 cocaina")
function faltaPagar(pago = {}) {
  return Object.entries(R.PAGAMENTO_2A)
    .map(([item, exigido]) => [item, exigido - (Number(pago[item]) || 0)])
    .filter(([, resta]) => resta > 0)
    .map(([item, resta]) => `${resta} ${item}`)
    .join(' + ');
}

// ── Lembrete: 12 h antes do prazo, o sócio recebe DM e a liderança vê quem ainda deve ─────────
async function agendarLembrete(linha, prazoEm) {
  const quando = new Date(prazoEm.getTime() - ANTECEDENCIA_MS);
  if (quando <= new Date()) return null; // prazo curto demais: o aviso da própria ADV já basta
  return agendar(TIPO_LEMBRETE, quando, { advId: linha.id, membroId: linha.discord_id });
}

async function lembrar(client, { advId }) {
  const linha = (await repo.pendentes()).find(p => String(p.id) === String(advId));
  if (!linha) return 'ignorada'; // já paga, vencida ou removida
  const falta = faltaPagar(linha.pago);
  if (!falta) return 'ignorada';
  const prazo = ts(linha.prazo_em);

  let dm = false;
  try {
    const usuario = await client.users.fetch(linha.discord_id);
    await usuario.send({
      embeds: [{
        color: tema.cor.aviso,
        title: '⏰ SUA 2ª ADVERTÊNCIA VENCE EM BREVE',
        description: `Falta pagar **${falta}** no baú da torcida até <t:${prazo}:F> (<t:${prazo}:R>). Sem o pagamento no prazo, o cargo de sócio é removido.`,
      }],
    });
    dm = true;
  } catch { /* DM fechada: o aviso no canal já ficou registrado */ }

  const guild = await client.guilds.fetch(config.guildId);
  await enviarNoCanal(guild, config.canais.advPendentes, {
    color: tema.cor.aviso,
    title: '⏰ 2ª ADVERTÊNCIA VENCE EM ~12 H — AINDA NÃO PAGA',
    fields: [
      { name: 'MEMBRO', value: `<@${linha.discord_id}>`, inline: true },
      { name: 'FALTA PAGAR', value: falta, inline: true },
      { name: 'PRAZO', value: `<t:${prazo}:F> (<t:${prazo}:R>)`, inline: false },
      { name: 'DM AO MEMBRO', value: dm ? 'entregue' : 'não entregue (DM fechada)', inline: true },
    ],
    footer: { text: 'Lembrete automático. Sem pagamento, o cargo de sócio sai no prazo.' },
  }, await mencoesDoSocio(linha.discord_id));
  return 'avisada';
}

// ── Painel vivo: quem deve, quanto falta e as últimas baixas ──────────────────────────────────
let clientAtual = null;

async function montarBlocos() {
  const [pendentes, encerrados] = await Promise.all([repo.pendentes(), repo.pagamentosEncerrados(8)]);
  const linhasPendentes = pendentes.map(p => {
    const falta = faltaPagar(p.pago);
    return `<@${p.discord_id}> · #${p.id_fivem} · vence <t:${ts(p.prazo_em)}:R>\n> falta: ${falta || 'tudo pago (aguardando baixa)'}`;
  });
  const linhasEncerrados = encerrados.map(p => `<@${p.discord_id}> · ${p.status.replace('_', ' ')} · <t:${ts(p.resolvida_em ?? p.criada_em)}:R>`);
  const cabecalho = `**Pagamentos pendentes:** ${pendentes.length} · **Item exigido:** ${Object.entries(R.PAGAMENTO_2A).map(([i, q]) => `${q} ${i}`).join(' + ')}`;
  return F.blocosDeEmbeds([
    ...F.embedsDeLista({
      titulo: tema.titulo(`${tema.emoji.pendente} PAGAMENTOS PENDENTES (2ª ADV)`), cabecalho,
      linhas: linhasPendentes, vazio: 'Nenhum pagamento pendente.', fonte: 'Do mais próximo de vencer ao mais distante · atualiza sozinho',
    }),
    ...F.embedsDeLista({
      titulo: tema.titulo(`${tema.emoji.recusado} ÚLTIMAS BAIXAS`), cabecalho: null,
      linhas: linhasEncerrados, vazio: 'Nenhuma baixa registrada ainda.', fonte: 'Pagas, vencidas e removidas',
    }),
  ]);
}

const painel = criarPainelCanal({
  slug: 'adv_pendencias',
  nomeCanal: '⏳・pagamentos-pendentes',
  razao: 'Fila viva de 2ª advertência de sócio com pagamento pendente',
  intervaloMin: 30,
  debounceMs: 5 * 1000,
  montarBlocos,
  canalVizinhoId: config.canais.advPendentes,
});

function iniciarPainel(client) {
  clientAtual = client;
  painel.iniciar(client);
}

// A fila mudou (nasceu, foi paga, venceu, foi removida): painel na hora e aviso a quem reage
// (o painel só reage depois de iniciado; antes disso não há canal para atualizar)
function pendenciaMudou(client, { advId = null, encerrada = false } = {}) {
  if (clientAtual) painel.agendarAtualizacaoReativa(clientAtual);
  if (encerrada && advId) barramento.emitir('adv.pendencia_encerrada', { client: client ?? clientAtual, advId });
}

registrarTipo(TIPO_LEMBRETE, lembrar);

module.exports = { agendarLembrete, lembrar, faltaPagar, montarBlocos, iniciarPainel, pendenciaMudou, TIPO_LEMBRETE };
