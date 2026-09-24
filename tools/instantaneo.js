// Retrato do que o bot registra na subida: comandos slash, prefixos de
// interação (registrarModulo) e listeners de evento. Serve para provar que uma
// refatoração de estrutura não perdeu nem trocou nada, e para ver o efeito de
// TENANT/tenant.modulos. Não conecta no Discord nem no banco.
//   node tools/instantaneo.js                       → tenant ativo
//   TENANT=_exemplo node tools/instantaneo.js
// Sempre um banco falso e inalcançável: estas ferramentas nunca podem tocar no banco real (incidente de 2026-09-13).
process.env.DATABASE_URL = 'postgres://teste:teste@127.0.0.1:1/teste';
process.env.DISCORD_TOKEN = 'teste';

function clienteFalso() {
  const listeners = [];
  return {
    listeners,
    commands: new Map(),
    on(evento, fn) { listeners.push({ evento, once: false, aridade: fn.length }); },
    once(evento, fn) { listeners.push({ evento, once: true, aridade: fn.length }); },
  };
}

function retrato(client, plataforma) {
  const { prefixosRegistrados } = require('../utils/modulos');
  const porEvento = {};
  for (const l of client.listeners) porEvento[l.evento] = (porEvento[l.evento] || 0) + 1;
  return {
    modulosLigados: plataforma.ativos.map(m => m.id),
    modulosDesligados: plataforma.desligados.map(m => m.id),
    comandos: [...client.commands.keys()].sort(),
    prefixosInteracao: prefixosRegistrados(),
    listeners: porEvento,
  };
}

function tirarRetrato() {
  const plataforma = require('../plataforma');
  const client = clienteFalso();
  const log = console.log;
  console.log = () => {}; // plataforma.subir() imprime o resumo; aqui só queremos o JSON
  try {
    plataforma.subir(client);
  } finally {
    console.log = log;
  }
  return retrato(client, plataforma);
}

if (require.main === module) {
  console.log(JSON.stringify(tirarRetrato(), null, 2));
  process.exit(0);
}

module.exports = { clienteFalso, retrato, tirarRetrato };
