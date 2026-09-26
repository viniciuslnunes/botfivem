// Batida de vida para a loja/painel de controle: de tempos em tempos a instância
// diz "estou aqui, nesta versão, com estes módulos, neste estado". A loja usa
// isso para listar torcidas com bot no ar, degradado ou parado (sem batida).
//
// Desligado por padrão: só liga com CONTROLE_URL. A batida NÃO leva segredo nem
// dado de torcida (sem ID de canal, sem token, sem conteúdo): só slug, guild,
// versão, saúde e ids de módulo. Suspender um plano é papel da loja (parar a
// instância); o bot só informa.
//   CONTROLE_URL            endpoint que recebe POST JSON
//   CONTROLE_TOKEN          segredo desta instância (Authorization: Bearer)
//   CONTROLE_INTERVALO_SEG  padrão 60 (mínimo 10)
const { montarEstadoDeSaude } = require('./saude');

function montarBatida({ saude, tenant, plataforma, versao }) {
  return {
    slug: tenant.slug,
    guildId: tenant.guildId,
    versao,
    status: saude.status,
    modoInstalacao: saude.modoInstalacao,
    uptimeSeg: saude.uptimeSeg,
    discordPronto: saude.discord.pronto,
    bancoOk: saude.banco.ok,
    modulos: plataforma.ativos.map(m => m.id),
    emitidaEm: new Date().toISOString(),
  };
}

function lerConfig(env) {
  if (!env.CONTROLE_URL) return null;
  let url;
  try { url = new URL(env.CONTROLE_URL); } catch { throw new Error(`CONTROLE_URL inválida: "${env.CONTROLE_URL}"`); }
  if (!env.CONTROLE_TOKEN) throw new Error('CONTROLE_URL definida sem CONTROLE_TOKEN');
  const seg = env.CONTROLE_INTERVALO_SEG === undefined || env.CONTROLE_INTERVALO_SEG === '' ? 60 : Number(env.CONTROLE_INTERVALO_SEG);
  if (!Number.isFinite(seg) || seg < 10) throw new Error(`CONTROLE_INTERVALO_SEG inválido: "${env.CONTROLE_INTERVALO_SEG}" (mínimo 10)`);
  return { url: url.toString(), token: env.CONTROLE_TOKEN, intervaloMs: seg * 1000 };
}

// Uma batida. Nunca lança: a loja fora do ar não pode derrubar o bot.
async function enviarBatida({ config, batida, fetchFn = fetch, prazoMs = 5000 }) {
  try {
    const res = await fetchFn(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
      body: JSON.stringify(batida),
      signal: AbortSignal.timeout(prazoMs),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, erro: err.message };
  }
}

function iniciarHeartbeat({ client, plataforma, tenant, banco, env = process.env, fetchFn, versao = require('../package.json').version }) {
  const config = lerConfig(env);
  if (!config) return null;
  let falhas = 0;
  const bater = async () => {
    const saude = await montarEstadoDeSaude({ client, plataforma, tenant, banco }).catch(err => ({
      status: 'degradado', modoInstalacao: false, uptimeSeg: 0, discord: { pronto: false }, banco: { ok: false, erro: err.message },
    }));
    const r = await enviarBatida({ config, batida: montarBatida({ saude, tenant, plataforma, versao }), fetchFn });
    if (r.ok) { falhas = 0; return; }
    falhas += 1;
    // Só o 1º erro e de tempos em tempos: a loja parada não pode encher o log.
    if (falhas === 1 || falhas % 30 === 0) console.warn(`[controle] batida não entregue (${r.erro || `HTTP ${r.status}`}), tentativa ${falhas}`);
  };
  const timer = setInterval(bater, config.intervaloMs);
  timer.unref();
  bater();
  return { parar: () => clearInterval(timer), bater };
}

module.exports = { montarBatida, lerConfig, enviarBatida, iniciarHeartbeat };
