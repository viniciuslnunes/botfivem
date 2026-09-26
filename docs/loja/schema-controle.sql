-- Banco de CONTROLE da loja (um só, do operador do produto). Não é o banco de
-- nenhuma torcida: cada torcida continua com o Postgres dela (docs/loja/README.md).
-- Aqui não entra token de bot nem dado de recrutamento/log: só cadastro comercial,
-- vigência e saúde. Segredos ficam em cofre e aqui só a referência.

CREATE TABLE IF NOT EXISTS planos (
  id            TEXT PRIMARY KEY,               -- 'basico', 'completo'
  nome          TEXT NOT NULL,
  preco_centavos INTEGER NOT NULL CHECK (preco_centavos >= 0),
  modulos       TEXT[] NOT NULL,                -- ids de módulo liberados (catálogo: npm run catalogo)
  limite_membros INTEGER,                       -- NULL = sem limite
  ativo         BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS torcidas (
  id            BIGSERIAL PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9_-]*$'),
  nome          TEXT NOT NULL,
  guild_id      TEXT NOT NULL UNIQUE CHECK (guild_id ~ '^[0-9]{17,20}$'),
  fonte_logs    TEXT NOT NULL DEFAULT 'hoolibras',
  responsavel   TEXT,                           -- contato humano (LGPD: controlador/operador em docs/comercial.md)
  criada_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assinaturas (
  id            BIGSERIAL PRIMARY KEY,
  torcida_id    BIGINT NOT NULL REFERENCES torcidas(id) ON DELETE CASCADE,
  plano_id      TEXT NOT NULL REFERENCES planos(id),
  inicio        DATE NOT NULL,
  vigente_ate   DATE NOT NULL,
  carencia_dias INTEGER NOT NULL DEFAULT 5 CHECK (carencia_dias >= 0),
  cancelada_em  TIMESTAMPTZ,
  CHECK (vigente_ate >= inicio)
);
CREATE INDEX IF NOT EXISTS assinaturas_torcida_idx ON assinaturas (torcida_id, vigente_ate DESC);

-- Uma instância = um bot + um Postgres. `segredo_ref` aponta para o cofre.
CREATE TABLE IF NOT EXISTS instancias (
  torcida_id    BIGINT PRIMARY KEY REFERENCES torcidas(id) ON DELETE CASCADE,
  imagem_versao TEXT,                           -- versão que DEVERIA estar no ar
  segredo_ref   TEXT NOT NULL,                  -- referência do cofre (token do bot, DATABASE_URL, CONTROLE_TOKEN)
  token_batida_hash TEXT NOT NULL,              -- hash do CONTROLE_TOKEN (nunca o valor)
  modulos       TEXT[] NOT NULL DEFAULT '{}',   -- o que o tenant liga (espelho do tenant.js)
  intervalo_batida_seg INTEGER NOT NULL DEFAULT 60
);

-- Última batida de cada instância (upsert a cada POST) + histórico enxuto.
CREATE TABLE IF NOT EXISTS batida_atual (
  torcida_id    BIGINT PRIMARY KEY REFERENCES torcidas(id) ON DELETE CASCADE,
  recebida_em   TIMESTAMPTZ NOT NULL,
  versao        TEXT,
  status        TEXT NOT NULL CHECK (status IN ('ok', 'degradado')),
  modo_instalacao BOOLEAN NOT NULL DEFAULT FALSE,
  uptime_seg    INTEGER,
  discord_pronto BOOLEAN,
  banco_ok      BOOLEAN,
  modulos       TEXT[]
);

CREATE TABLE IF NOT EXISTS batida_historico (
  id            BIGSERIAL PRIMARY KEY,
  torcida_id    BIGINT NOT NULL REFERENCES torcidas(id) ON DELETE CASCADE,
  recebida_em   TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS batida_hist_idx ON batida_historico (torcida_id, recebida_em DESC);

CREATE TABLE IF NOT EXISTS auditoria (
  id            BIGSERIAL PRIMARY KEY,
  quando        TIMESTAMPTZ NOT NULL DEFAULT now(),
  quem          TEXT NOT NULL,
  acao          TEXT NOT NULL,                  -- 'suspender', 'reativar', 'trocar_plano', 'provisionar'
  torcida_id    BIGINT REFERENCES torcidas(id) ON DELETE SET NULL,
  detalhe       JSONB
);

-- O que a vitrine e o painel mostram. Plano: vigente | carencia | vencido | sem_plano.
-- Bot: no_ar (batida recente e ok) | degradado | parado (sem batida em 3 intervalos) | nunca.
CREATE OR REPLACE VIEW torcidas_status AS
SELECT
  t.id, t.slug, t.nome,
  a.plano_id, a.vigente_ate,
  CASE
    WHEN a.id IS NULL OR a.cancelada_em IS NOT NULL THEN 'sem_plano'
    WHEN a.vigente_ate >= CURRENT_DATE THEN 'vigente'
    WHEN a.vigente_ate + a.carencia_dias >= CURRENT_DATE THEN 'carencia'
    ELSE 'vencido'
  END AS plano_situacao,
  CASE
    WHEN b.torcida_id IS NULL THEN 'nunca'
    WHEN b.recebida_em < now() - (3 * COALESCE(i.intervalo_batida_seg, 60)) * INTERVAL '1 second' THEN 'parado'
    WHEN b.status = 'ok' THEN 'no_ar'
    ELSE 'degradado'
  END AS bot_situacao,
  b.recebida_em AS ultima_batida,
  b.versao AS versao_no_ar
FROM torcidas t
LEFT JOIN LATERAL (
  SELECT * FROM assinaturas s WHERE s.torcida_id = t.id ORDER BY s.vigente_ate DESC LIMIT 1
) a ON TRUE
LEFT JOIN instancias i ON i.torcida_id = t.id
LEFT JOIN batida_atual b ON b.torcida_id = t.id;
