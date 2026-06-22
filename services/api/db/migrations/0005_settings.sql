-- Per-workspace settings: active inference provider, provider configs (NO keys),
-- RBAC grants, feature toggles.

CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id      TEXT PRIMARY KEY,
  active_provider_id TEXT NOT NULL DEFAULT '',
  providers         JSONB NOT NULL DEFAULT '[]'::jsonb,
  rbac              JSONB NOT NULL DEFAULT '{"grants":{}}'::jsonb,
  feature_toggles   JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
