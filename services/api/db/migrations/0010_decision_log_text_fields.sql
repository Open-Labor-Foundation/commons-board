-- Change decision_log.event and decision_log.signed from JSONB to TEXT.
--
-- JSONB normalizes key order (alphabetical), which breaks hash-chain
-- verification: entryHash() uses JSON.stringify() which is key-order-
-- sensitive. Storing the original JSON string as TEXT preserves byte-for-byte
-- fidelity, so the hash recomputed on read matches the hash computed on write.
--
-- The cast ::text returns the JSONB canonical form (sorted keys), which is
-- NOT the original insertion-order string. For existing backfilled rows this
-- means their stored entry_hash will no longer match a recomputation. Those
-- rows were verified at backfill time (chain was intact). Going forward, new
-- rows store the exact JSON string and verify correctly.
--
-- For a clean cutover, the backfill should be re-run after this migration
-- (ON CONFLICT DO NOTHING means existing rows are NOT overwritten — to fix
-- existing rows, truncate decision_log and re-backfill from JSON files).

ALTER TABLE decision_log
  ALTER COLUMN event TYPE TEXT USING event::text,
  ALTER COLUMN signed TYPE TEXT USING signed::text;