// Ponto de saúde para orquestrador (Railway, Docker, monitor externo): com
// HEALTH_PORT o bot responde GET /health com 200 (ok) ou 503 (degradado) e um
// JSON curto. Não expõe segredo nem dado de torcida: só o slug, booleans e números.
const http = require('http');

// `banco.query('SELECT 1')` com prazo: um banco pendurado não pode pendurar o health.
function comPrazo(promessa, ms) {
  let timer;
  const prazo = new Promise((_, rejeitar) => {
    // Sem unref: com o banco pendurado, é este timer que mantém o processo vivo até o prazo disparar.
    timer = setTimeout(() => rejeitar(new Error(`sem resposta em ${ms} ms`)), ms);
  });
  // Limpa ao terminar (bem ou mal): uma consulta rápida não deixa timer pendurado.
  return Promise.race([promessa, prazo]).finally(() => clearTimeout(timer));
}

async function montarEstadoDeSaude({ client, plataforma, tenant, banco, agora = Date.now, prazoBancoMs = 2000 }) {
  const t0 = agora();
  const bancoOk = await comPrazo(banco.query('SELECT 1'), prazoBancoMs)
    .then(() => ({ ok: true, ms: agora() - t0 }), err => ({ ok: false, erro: err.message }));
  const discordPronto = typeof client.isReady === 'function' ? client.isReady() : false;
  return {
    status: bancoOk.ok && discordPronto ? 'ok' : 'degradado',
    tenant: tenant.slug,
    modoInstalacao: Boolean(plataforma.modoInstalacao),
    uptimeSeg: Math.floor(process.uptime()),
    discord: { pronto: discordPronto },
    banco: bancoOk,
    modulos: { ligados: plataforma.ativos.length, desligados: plataforma.desligados.length },
  };
}

function porta(valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`HEALTH_PORT inválida: "${valor}" (0 a 65535; 0 = porta livre aleatória)`);
  return n;
}

// Servidor HTTP mínimo. `obter` devolve o estado; nada além de GET /health.
function criarServidorDeSaude({ porta: valorPorta, host = '0.0.0.0', obter }) {
  const servidor = http.createServer(async (req, res) => {
    const enviar = (codigo, corpo) => {
      const texto = JSON.stringify(corpo);
      res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(texto) });
      res.end(texto);
    };
    if (req.url !== '/health') return enviar(404, { erro: 'não encontrado' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return enviar(405, { erro: 'método não permitido' });
    try {
      const estado = await obter();
      return enviar(estado.status === 'ok' ? 200 : 503, estado);
    } catch (err) {
      return enviar(503, { status: 'degradado', erro: err.message });
    }
  });

  return {
    servidor,
    iniciar: () => new Promise((resolver, rejeitar) => {
      servidor.once('error', rejeitar);
      servidor.listen(porta(valorPorta), host, () => resolver(servidor.address().port));
    }),
    parar: () => new Promise(resolver => servidor.close(() => resolver())),
  };
}

module.exports = { montarEstadoDeSaude, criarServidorDeSaude, porta };
