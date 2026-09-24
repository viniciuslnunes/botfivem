// Opções do pool do Postgres a partir do ambiente. Puro (recebe `env`) para
// poder testar cada combinação sem abrir conexão.
//
// TLS (DATABASE_SSL):
//   verify     valida o certificado do servidor (use DATABASE_CA se o provedor usa CA própria)
//   no-verify  TLS ligado, certificado NÃO validado — o comportamento histórico do bot
//              (default, por compatibilidade com o Railway); aceita "man in the middle"
//   off        sem TLS (só banco local/rede privada)
const fs = require('fs');

const MODOS = ['verify', 'no-verify', 'off'];

function lerCa(valor, lerArquivo = arquivo => fs.readFileSync(arquivo, 'utf8')) {
  if (!valor) return undefined;
  if (valor.includes('BEGIN CERTIFICATE')) return valor.replace(/\\n/g, '\n');
  return lerArquivo(valor);
}

// Banco na própria máquina não é alvo de interceptação de rede: sem aviso.
function ehLocal(url) {
  try {
    const host = new URL(url).hostname;
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
  } catch {
    return false;
  }
}

function opcoesDoPool(env, { lerArquivo } = {}) {
  const avisos = [];
  const modo = env.DATABASE_SSL || 'no-verify';
  if (!MODOS.includes(modo)) {
    throw new Error(`DATABASE_SSL inválido: "${modo}" (use: ${MODOS.join(', ')})`);
  }

  const opcoes = { connectionString: env.DATABASE_URL };

  if (modo === 'verify') {
    opcoes.ssl = { rejectUnauthorized: true };
    const ca = lerCa(env.DATABASE_CA, lerArquivo);
    if (ca) opcoes.ssl.ca = ca;
  } else if (modo === 'no-verify') {
    opcoes.ssl = { rejectUnauthorized: false };
    if (!ehLocal(env.DATABASE_URL)) avisos.push('TLS do banco sem verificação de certificado (DATABASE_SSL=no-verify). Defina DATABASE_SSL=verify (e DATABASE_CA, se o provedor usa CA própria) para se proteger de interceptação.');
  }

  if (env.DATABASE_POOL_MAX !== undefined && env.DATABASE_POOL_MAX !== '') {
    const max = Number(env.DATABASE_POOL_MAX);
    if (!Number.isInteger(max) || max < 1 || max > 100) throw new Error(`DATABASE_POOL_MAX inválido: "${env.DATABASE_POOL_MAX}" (inteiro de 1 a 100)`);
    opcoes.max = max;
  }
  return { opcoes, avisos, modo };
}

module.exports = { opcoesDoPool, MODOS };
