const db = require('../db');
const config = require('../../config/index.js');

// Nome, emoji e ordem das áreas vêm da config; cargos e canal, do que o setup criou.
const CACHE_MS = 60 * 1000;
let cache = null;

async function carregarLinhas() {
  if (cache && Date.now() - cache.em < CACHE_MS) return cache.linhas;
  const { rows } = await db.query('SELECT slug, cargo_membro_id, cargo_gestor_id, canal_id, ativo FROM departamentos');
  cache = { em: Date.now(), linhas: rows };
  return rows;
}

async function listarDepartamentos({ apenasAtivos = false } = {}) {
  const porSlug = new Map((await carregarLinhas()).map(l => [l.slug, l]));
  return config.departamentos
    .map(area => {
      const linha = porSlug.get(area.slug);
      return {
        ...area,
        cargo_membro_id: linha?.cargo_membro_id ?? null,
        cargo_gestor_id: linha?.cargo_gestor_id ?? null,
        canal_id: linha?.canal_id ?? null,
        ativo: Boolean(linha?.ativo),
      };
    })
    .filter(area => !apenasAtivos || (area.ativo && area.cargo_membro_id && area.cargo_gestor_id));
}

async function buscarDepartamento(slug) {
  return (await listarDepartamentos()).find(area => area.slug === slug) ?? null;
}

async function salvarDepartamento({ slug, cargoMembroId, cargoGestorId, canalId }) {
  await db.query(
    `INSERT INTO departamentos (slug, cargo_membro_id, cargo_gestor_id, canal_id, ativo, atualizado_em)
     VALUES ($1, $2, $3, $4, true, now())
     ON CONFLICT (slug) DO UPDATE
       SET cargo_membro_id = $2, cargo_gestor_id = $3, canal_id = $4, ativo = true, atualizado_em = now()`,
    [slug, cargoMembroId, cargoGestorId, canalId]
  );
  cache = null;
}

// cargoId -> { slug, papel } para detectar mudança de área em guildMemberUpdate
async function mapaCargosDepartamento() {
  const mapa = new Map();
  for (const area of await listarDepartamentos({ apenasAtivos: true })) {
    mapa.set(area.cargo_membro_id, { slug: area.slug, papel: 'membro' });
    mapa.set(area.cargo_gestor_id, { slug: area.slug, papel: 'gestor' });
  }
  return mapa;
}

module.exports = { listarDepartamentos, buscarDepartamento, salvarDepartamento, mapaCargosDepartamento };
