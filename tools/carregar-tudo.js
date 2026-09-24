// Fumaça: carrega todo módulo de utils/commands/events. Pega ReferenceError de
// ordem de require (TDZ), tema ausente e sintaxe quebrada sem precisar do Discord
// nem do banco (o pool do pg só conecta na primeira query).
const path = require('path');
const { arquivosVarridos } = require('./conformidade');

// Sempre um banco falso e inalcançável: estas ferramentas nunca podem tocar no banco real (incidente de 2026-09-13).
process.env.DATABASE_URL = 'postgres://teste:teste@127.0.0.1:1/teste';
process.env.DISCORD_TOKEN = 'teste';

const falhas = [];
for (const arq of arquivosVarridos().filter(a => !['index.js', 'deploy-commands.js'].includes(a))) {
  try {
    require(path.join(__dirname, '..', arq));
  } catch (err) {
    falhas.push(`${arq}: ${err.message.split('\n')[0]}`);
  }
}
if (falhas.length) {
  console.error(`${falhas.length} módulo(s) não carregam:\n - ${falhas.join('\n - ')}`);
  process.exit(1);
}
console.log(`${arquivosVarridos().length - 2} módulos carregam sem erro`);
process.exit(0);
