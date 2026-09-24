// Log estruturado para quem hospeda o bot (Railway, Docker, agregador de logs):
// com LOG_FORMATO=json cada console.log/warn/error vira UMA linha JSON com
// horário, nível, torcida (tenant) e módulo — dá para filtrar por torcida e por
// módulo sem reescrever as ~100 chamadas de console do código. Sem a variável
// (ou LOG_FORMATO=texto) o console fica exatamente como sempre foi.
//
// Convenção que o código já segue: "[modulo] mensagem" → campo `modulo`.
const util = require('util');

const FORMATOS = ['texto', 'json'];
const NIVEL_POR_METODO = { log: 'info', info: 'info', debug: 'debug', warn: 'warn', error: 'error' };

function serializarErro(err) {
  return { nome: err.name, mensagem: err.message, ...(err.code !== undefined ? { code: err.code } : {}), stack: err.stack };
}

// Converte os argumentos de console.<metodo>(...) em um objeto de log.
function montarRegistro({ metodo, args, tenant, agora = new Date() }) {
  const registro = { ts: agora.toISOString(), nivel: NIVEL_POR_METODO[metodo] ?? 'info', tenant };

  const restantes = [];
  let erro;
  for (const a of args) {
    if (a instanceof Error && !erro) erro = a;
    else restantes.push(a);
  }

  let texto = restantes.map(a => (typeof a === 'string' ? a : util.inspect(a, { depth: 3, breakLength: Infinity }))).join(' ');
  const m = /^\[([A-Za-z0-9:_-]+)\]\s*/.exec(texto);
  if (m) {
    registro.modulo = m[1];
    texto = texto.slice(m[0].length);
  }
  registro.msg = texto || (erro ? erro.message : '');
  if (erro) registro.erro = serializarErro(erro);
  return registro;
}

function formatarLinha(entrada) {
  return JSON.stringify(montarRegistro(entrada));
}

// Substitui os métodos de `alvo` (o console) por escritores de linha JSON.
// Devolve uma função que restaura o original.
function instalarLog({ formato = 'texto', tenant, alvo = console, escrever } = {}) {
  if (!FORMATOS.includes(formato)) throw new Error(`LOG_FORMATO inválido: "${formato}" (use: ${FORMATOS.join(', ')})`);
  if (formato === 'texto') return () => {};

  const originais = {};
  for (const metodo of Object.keys(NIVEL_POR_METODO)) {
    originais[metodo] = alvo[metodo];
    const saida = escrever ?? (metodo === 'warn' || metodo === 'error' ? l => process.stderr.write(`${l}\n`) : l => process.stdout.write(`${l}\n`));
    alvo[metodo] = (...args) => saida(formatarLinha({ metodo, args, tenant }));
  }
  return () => { for (const [metodo, fn] of Object.entries(originais)) alvo[metodo] = fn; };
}

module.exports = { montarRegistro, formatarLinha, instalarLog, FORMATOS };
