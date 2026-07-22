-- Extension: votes columns present in VoteRecord TS type but absent from
-- 0002_collective.sql. Optional thresholds used by supermajority and
-- consensus methods.

ALTER TABLE votes
  ADD COLUMN IF NOT EXISTS supermajority_threshold NUMERIC,
  ADD COLUMN IF NOT EXISTS quorum_threshold         NUMERIC;