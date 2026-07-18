-- Extension: workspace_settings columns present in WorkspaceSettings TS type
-- but absent from 0005_settings.sql. org_name and governance_mode are scalar;
-- board_settings and inference_queue are structured and stored as JSONB.

ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS org_name        TEXT,
  ADD COLUMN IF NOT EXISTS governance_mode TEXT CHECK (governance_mode IN ('business', 'collective')),
  ADD COLUMN IF NOT EXISTS board_settings   JSONB,
  ADD COLUMN IF NOT EXISTS addin_catalog_url TEXT,
  ADD COLUMN IF NOT EXISTS inference_queue  JSONB;