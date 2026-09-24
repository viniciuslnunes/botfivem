const { Client, GatewayIntentBits, Partials } = require('discord.js');
require('dotenv').config();

const faltando = ['DISCORD_TOKEN', 'DATABASE_URL'].filter(nome => !process.env[nome]);
if (faltando.length) {
  console.error(`Faltam variáveis de ambiente: ${faltando.join(', ')}. Veja o .env.example.`);
  process.exit(1);
}

// Log em JSON (LOG_FORMATO=json) para quem hospeda: uma linha por evento, com tenant e módulo.
// Instalado antes de tudo para que até os erros de validação saiam no formato escolhido.
require('./plataforma/log').instalarLog({ formato: process.env.LOG_FORMATO || 'texto', tenant: require('./tenants/ativo').slug });

// Valida o tenant (TENANT, default "gavioes") e resolve os módulos ANTES de
// conectar: configuração errada derruba a subida com a lista completa de
// problemas, em vez de quebrar no meio de um fluxo em produção.
let plataforma;
try {
  plataforma = require('./plataforma');
} catch (err) {
  console.error('[boot] Configuração inválida — o bot não subiu:', err);
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// Carrega os módulos ligados (comandos, handlers) e liga os eventos do Discord
plataforma.subir(client);

client.login(process.env.DISCORD_TOKEN);
