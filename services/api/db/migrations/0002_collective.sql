-- Collective governance: members, votes, amendments, contributions.

CREATE TABLE IF NOT EXISTS members (
  member_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     TEXT NOT NULL REFERENCES orgs(id),
  display_name TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('member', 'steward', 'coordinator', 'observer')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  active     BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_members_org ON members (org_id);

CREATE TABLE IF NOT EXISTS votes (
  vote_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       TEXT NOT NULL REFERENCES orgs(id),
  decision_id  TEXT NOT NULL,
  decision_type TEXT NOT NULL,
  method       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'passed', 'failed', 'cancelled')),
  opened_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  closes_at    TIMESTAMPTZ NOT NULL,
  resolved_at  TIMESTAMPTZ,
  tally        JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_votes_org_status ON votes (org_id, status);

CREATE TABLE IF NOT EXISTS vote_ballots (
  ballot_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vote_id    UUID NOT NULL REFERENCES votes(vote_id),
  member_id  UUID NOT NULL REFERENCES members(member_id),
  choice     TEXT NOT NULL,
  cast_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vote_id, member_id)
);

CREATE TABLE IF NOT EXISTS amendments (
  amendment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       TEXT NOT NULL REFERENCES orgs(id),
  artifact_type TEXT NOT NULL,
  proposed_by  UUID REFERENCES members(member_id),
  proposed_payload JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'proposed'
               CHECK (status IN ('proposed', 'noticed', 'voting', 'applied', 'rejected')),
  notice_until TIMESTAMPTZ,
  vote_id      UUID REFERENCES votes(vote_id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS contributions (
  contribution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     TEXT NOT NULL REFERENCES orgs(id),
  member_id  UUID NOT NULL REFERENCES members(member_id),
  action_type TEXT NOT NULL,
  weight     NUMERIC NOT NULL DEFAULT 1,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contributions_org_member ON contributions (org_id, member_id);
