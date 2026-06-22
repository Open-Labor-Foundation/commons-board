-- Org economics. Two symmetric halves:
--   business mode -> monetization (bill the org's OWN customers)
--   collective mode -> treasury (pooled revenue + governed distribution)
-- The only thing absent platform-wide: OLF never bills the org for the platform.

-- ----- Business monetization (inverted from the prior billing engine) -----
CREATE TABLE IF NOT EXISTS monetization_plans (
  plan_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     TEXT NOT NULL REFERENCES orgs(id),
  name       TEXT NOT NULL,
  pricing_model TEXT NOT NULL CHECK (pricing_model IN ('subscription', 'per_seat', 'one_time', 'tiered')),
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency   TEXT NOT NULL DEFAULT 'usd',
  entitlements JSONB NOT NULL DEFAULT '[]'::jsonb,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS monetization_subscriptions (
  subscription_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     TEXT NOT NULL REFERENCES orgs(id),
  plan_id    UUID NOT NULL REFERENCES monetization_plans(plan_id),
  customer_ref TEXT NOT NULL,
  seats      INTEGER NOT NULL DEFAULT 1,
  status     TEXT NOT NULL DEFAULT 'active'
             CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_subs_org ON monetization_subscriptions (org_id);

CREATE TABLE IF NOT EXISTS monetization_invoices (
  invoice_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     TEXT NOT NULL REFERENCES orgs(id),
  subscription_id UUID REFERENCES monetization_subscriptions(subscription_id),
  customer_ref TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency   TEXT NOT NULL DEFAULT 'usd',
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'paid', 'void')),
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at    TIMESTAMPTZ
);

-- ----- Collective treasury -----
CREATE TABLE IF NOT EXISTS treasury_accounts (
  account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     TEXT NOT NULL REFERENCES orgs(id),
  name       TEXT NOT NULL DEFAULT 'general',
  balance_cents BIGINT NOT NULL DEFAULT 0,
  reserve_floor_cents BIGINT NOT NULL DEFAULT 0,
  currency   TEXT NOT NULL DEFAULT 'usd',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS treasury_distributions (
  distribution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     TEXT NOT NULL REFERENCES orgs(id),
  account_id UUID NOT NULL REFERENCES treasury_accounts(account_id),
  model      TEXT NOT NULL CHECK (model IN ('equal_share', 'contribution_weighted', 'hybrid')),
  total_cents BIGINT NOT NULL,
  vote_id    UUID REFERENCES votes(vote_id),
  allocations JSONB NOT NULL DEFAULT '[]'::jsonb,
  status     TEXT NOT NULL DEFAULT 'proposed'
             CHECK (status IN ('proposed', 'approved', 'executed', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at TIMESTAMPTZ
);
