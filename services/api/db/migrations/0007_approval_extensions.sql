-- Extension: approval_records columns present in ApprovalRecord TS type but
-- absent from 0001_core.sql. Makes them queryable and typed instead of buried
-- in JSONB.

ALTER TABLE approval_records
  ADD COLUMN IF NOT EXISTS action_type  TEXT,
  ADD COLUMN IF NOT EXISTS summary      TEXT,
  ADD COLUMN IF NOT EXISTS risk_score   INTEGER,
  ADD COLUMN IF NOT EXISTS blast_radius TEXT CHECK (blast_radius IN ('low', 'medium', 'high'));