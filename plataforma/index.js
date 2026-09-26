// Plataforma do tenant ativo: escolhe os módulos que sobem, valida na subida e
// liga tudo ao client. Ponto de entrada usado por index.js.
const config = require('../config');
const tema = require('../tema');
const manifestos = require('../modulos');
const { criarPlataforma } = require('./criar');
const { registrarEventos } = require('./eventos');
const { montarEstadoDeSaude, criarServidorDeSaude } = require('./saude');
const { iniciarHeartbeat } = require('./heartbeat');

const plataforma = criarPlataforma({ manifestos, tenant: config, tema });

// HEALTH_PORT liga GET /health (200 ok / 503 degradado) para orquestrador e monitor.
function iniciarSaude(client) {
  if (process.env.HEALTH_PORT === undefined || process.env.HEALTH_PORT === '') return;
  const banco = require('../utils/db');
  const saude = criarServidorDeSaude({
    porta: process.env.HEALTH_PORT,
    host: process.env.HEALTH_HOST || '0.0.0.0',
    obter: () => montarEstadoDeSaude({ client, plataforma, tenant: config, banco }),
  });
  saude.iniciar()
    .then(p => console.log(`[saude] GET /health na porta ${p}`))
    .catch(err => console.error('[saude] Não foi possível abrir o health:', err.message));
}

// Carrega módulos e comandos e liga os eventos. O client já deve ter sido criado
// (e o login feito por quem chama).
function subir(client) {
  const { executarMigracoes } = require('../utils/migracoes');
  const { iniciarAgendador } = require('../utils/agendador');

  plataforma.carregarModulos(client);
  registrarEventos(client, plataforma, { executarMigracoes, iniciarAgendador });

  iniciarSaude(client);
  if (process.env.CONTROLE_URL) iniciarHeartbeat({ client, plataforma, tenant: config, banco: require('../utils/db') });

  const ligados = plataforma.ativos.map(m => m.id).join(', ');
  const desligados = plataforma.desligados.map(m => m.id).join(', ') || '—';
  console.log(`[plataforma] tenant "${config.slug}" — módulos ligados: ${ligados}`);
  console.log(`[plataforma] módulos desligados: ${desligados}`);
}

module.exports = { ...plataforma, subir };
