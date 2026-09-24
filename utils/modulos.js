// Roteador de interações por módulo. customId no formato "<modulo>:<acao>:...".
// Módulo novo registra aqui em vez de crescer o interactionCreate.
const modulos = new Map();

function registrarModulo(prefixo, handler) {
  modulos.set(prefixo, handler);
}

async function despacharInteracao(interaction) {
  const customId = interaction.customId;
  if (typeof customId !== 'string') return false;
  const handler = modulos.get(customId.split(':')[0]);
  if (!handler) return false;
  await handler(interaction);
  return true;
}

// Só para diagnóstico e teste de paridade (tools/instantaneo.js).
function prefixosRegistrados() {
  return [...modulos.keys()].sort();
}

module.exports = { registrarModulo, despacharInteracao, prefixosRegistrados };
