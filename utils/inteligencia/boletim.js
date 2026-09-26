// Boletim semanal para a liderança: o resumo do que os cruzamentos mostraram na semana, publicado
// sozinho no canal 🧠・inteligência. Cada seção é um relatório de relatorios.js; uma seção que
// falha não derruba as outras.
const config = require('../../config/index.js');
const tema = require('../../tema');
const { lerConfig, gravarConfig } = require('../botConfig');
const R = require('./regras');
const rel = require('./relatorios');
const { garantirCanalInteligencia, mencoesLideranca } = require('./canais');

const CHAVE_ULTIMO = 'boletim_inteligencia_ultimo';
const INTERVALO_CHECAGEM_MS = R.HORA_MS;
const PERIODO_MS = 7 * R.DIA_MS;

async function secoes(client) {
  const relatorios = require('../logsJogo/relatorios');
  const { carregarSocios } = require('./pessoas');
  const { socios } = await carregarSocios(client);
  const tempoJogadoPorId = periodo => relatorios.tempoJogadoPorId(periodo);
  return [
    ['casos', () => rel.embedCasos()],
    ['risco', () => rel.embedRisco()],
    ['esfriando', () => rel.embedEsfriando()],
    ['recrutamento', () => rel.embedRecrutamento()],
    ['manto', () => rel.embedManto()],
    ['cobertura', () => rel.embedCobertura({ recrutadoresIds: rel.recrutadoresIdsDe(socios) })],
    ['retenção', () => rel.embedRetencao()],
    ['disciplina', () => rel.embedDisciplina()],
    ['contribuição', () => rel.embedContribuicao()],
    ['farm', () => rel.embedFarm({ tempoJogadoPorId, socios })],
    ['patrimônio', () => rel.embedPatrimonio()],
    ['finanças', () => rel.embedFinancas()],
    ['eventos', () => rel.embedEventos({ socios })],
    ['território', () => rel.embedTerritorio()],
    ['tickets', () => rel.embedTickets()],
    ['departamentos', () => rel.embedDepartamentos(client, { tempoJogadoPorId, socios })],
  ];
}

async function publicarBoletim(client, { canal = null } = {}) {
  const destino = canal ?? await garantirCanalInteligencia(client);
  await destino.send({
    content: mencoesLideranca(),
    allowedMentions: { roles: config.lideranca.filter(Boolean) },
    embeds: [{
      color: tema.cor.primaria,
      title: '🧠 BOLETIM SEMANAL DA INTELIGÊNCIA',
      description: 'O que os cruzamentos entre Discord e logs do jogo mostraram. Tudo aqui **informa**; nenhuma punição sai daqui.',
      timestamp: new Date().toISOString(),
    }],
  });
  let publicadas = 0;
  for (const [nome, montar] of await secoes(client)) {
    try {
      await destino.send({ embeds: [await montar()] });
      publicadas++;
    } catch (err) {
      console.error(`[inteligencia] Seção "${nome}" do boletim falhou:`, err);
    }
  }
  return publicadas;
}

// Publica se a última edição tem 7 dias ou mais (ou nunca houve). O horário vira o do primeiro
// ciclo depois do vencimento, e sobrevive a reinício por causa do bot_config.
async function publicarSeVencido(client, agora = new Date()) {
  const ultimo = Number(await lerConfig(CHAVE_ULTIMO)) || 0;
  if (agora.getTime() - ultimo < PERIODO_MS) return false;
  await gravarConfig(CHAVE_ULTIMO, String(agora.getTime())); // antes: falha no meio não repete em loop
  await publicarBoletim(client);
  return true;
}

let timer = null;
function iniciar(client) {
  const rodar = () => publicarSeVencido(client).catch(err => console.error('[inteligencia] Boletim falhou:', err));
  setTimeout(rodar, 10 * 60 * 1000).unref();
  timer = setInterval(rodar, INTERVALO_CHECAGEM_MS);
  timer.unref();
}

module.exports = { publicarBoletim, publicarSeVencido, iniciar };
