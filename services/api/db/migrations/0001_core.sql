-- Core governance substrate: orgs, artifacts, governance events, decision log, approvals.

CREATE TABLE IF NOT EXISTS orgs (
  id              TEXT PRIMARY KEY,
  org_name        TEXT NOT NULL,
  governance_mode TEXT NOT NULL CHECK (governance_mode IN ('business', 'collective')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       TEXT NOT NULL REFERENCES orgs(id),
  type         TEXT NOT NULL,
  version      INTEGER NOT NULL,
  payload      JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, type, version)
);
CREATE INDEX IF NOT EXISTS idx_artifacts_org_type ON artifacts (org_id, type);

CREATE TABLE IF NOT EXISTS governance_events (
  event_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        TEXT NOT NULL REFERENCES orgs(id),
  event_type    TEXT NOT NULL,
  actor         TEXT NOT NULL,
  artifact_type TEXT,
  artifact_id   UUID,
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,
  at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_governance_events_org ON governance_events (org_id);

-- Append-only, hash-chained decision log. One sequence per org.
CREATE TABLE IF NOT EXISTS decision_log (
  entry_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        TEXT NOT NULL REFERENCES orgs(id),
  sequence      INTEGER NOT NULL,
  event         JSONB NOT NULL,
  signed        JSONB NOT NULL,
  previous_hash TEXT NOT NULL,
  entry_hash    TEXT NOT NULL,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, sequence)
);

CREATE TABLE IF NOT EXISTS approval_records (
  approval_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            TEXT NOT NULL REFERENCES orgs(id),
  action_id         TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  required_approvers INTEGER NOT NULL DEFAULT 1,
  responses         JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_approvals_org_status ON approval_records (org_id, status);
