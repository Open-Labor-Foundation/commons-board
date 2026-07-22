-- Change decision_log.event and decision_log.signed from JSONB to TEXT.
--
-- JSONB normalizes key order (alphabetical), which breaks hash-chain
-- verification: entryHash() uses JSON.stringify() which is key-order-
-- sensitive. Storing the original JSON string as TEXT preserves byte-for-byte
-- fidelity, so the hash recomputed on read matches the hash computed on write.
--
-- IMPORTANT: The cast ::text returns the JSONB canonical form (sorted keys),
-- NOT the original insertion-order string. For existing backfilled rows this
-- means their stored entry_hash will no longer match a recomputation.
--
-- Clean cutover procedure (what was done in Phase 7):
--   1. Apply this migration (JSONB → TEXT via ::text cast)
--   2. TRUNCATE decision_log (removes the canonicalized-key rows)
--   3. Re-run the backfill script (inserts JSON.stringify(event) directly
--      into TEXT columns, preserving original key order)
--   4. Verify: GET /api/v1/decision-log/verify returns {valid: true}
--
-- Going forward, new rows store the exact JSON string via JSON.stringify()
-- in appendEventDb(), and verifyLog() parses the TEXT back to objects to
-- recompute the hash — key order is preserved end-to-end.

ALTER TABLE decision_log
  ALTER COLUMN event TYPE TEXT USING event::text,
  ALTER COLUMN signed TYPE TEXT USING signed::text;