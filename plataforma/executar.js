// Executa hooks dos módulos ativos. Cada hook recebe os argumentos do evento e,
// por último, `contexto` (opções.contexto) — o que a plataforma quer expor aos
// módulos (ex.: painéis de log ativos), sem eles importarem a plataforma.
// Um módulo que falha NÃO derruba os outros:
// o erro é registrado com o nome do módulo e o resto segue (antes, uma exceção
// no meio do ready ou do guildMemberUpdate abortava tudo que vinha depois).

function registrarErro(modulo, hook, err, log) {
  log(`[${modulo.id}:${hook}] Erro:`, err);
}

// Um por vez, esperando cada um (mensagem, membro, reação: a ordem importa).
async function executarEmSequencia(ativos, hook, args, { log = console.error, contexto } = {}) {
  for (const m of ativos) {
    if (typeof m[hook] !== 'function') continue;
    try {
      await m[hook](...args, contexto);
    } catch (err) {
      registrarErro(m, hook, err, log);
    }
  }
}

// Como executarEmSequencia, mas para no primeiro módulo que devolver true
// ("consumi esta mensagem"). Devolve true se algum consumiu.
async function executarAteConsumir(ativos, hook, args, { log = console.error, contexto } = {}) {
  for (const m of ativos) {
    if (typeof m[hook] !== 'function') continue;
    try {
      if (await m[hook](...args, contexto) === true) return true;
    } catch (err) {
      registrarErro(m, hook, err, log);
    }
  }
  return false;
}

// Dispara todos na ordem SEM esperar terminar (partida do bot: cada módulo
// sobe por conta própria, como o ready fazia com as rotinas "fire and forget").
// Erro síncrono e rejeição de promise caem no log do módulo.
function dispararSemEsperar(ativos, hook, args, { log = console.error, contexto } = {}) {
  for (const m of ativos) {
    if (typeof m[hook] !== 'function') continue;
    try {
      const r = m[hook](...args, contexto);
      if (r && typeof r.catch === 'function') r.catch(err => registrarErro(m, hook, err, log));
    } catch (err) {
      registrarErro(m, hook, err, log);
    }
  }
}

module.exports = { executarEmSequencia, executarAteConsumir, dispararSemEsperar };
