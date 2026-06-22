-- labor-commons integration: specialist refs backing chairs, and recorded gaps.

CREATE TABLE IF NOT EXISTS catalog_refs (
  ref_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL REFERENCES orgs(id),
  chair_id        TEXT NOT NULL,
  specialist_slug TEXT NOT NULL,
  catalog_path    TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('primary', 'supporting')),
  pinned_ref      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_refs_org_chair ON catalog_refs (org_id, chair_id);

CREATE TABLE IF NOT EXISTS catalog_gaps (
  gap_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL REFERENCES orgs(id),
  function_description TEXT NOT NULL,
  domain_hint     TEXT,
  submitted_to_labor_commons BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_catalog_gaps_org ON catalog_gaps (org_id);
