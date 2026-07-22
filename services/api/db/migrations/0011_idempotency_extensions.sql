-- Add status and response columns to request_idempotency_keys.
--
-- The persistent idempotency store (lib/idempotency-store.ts) needs to
-- record the final HTTP status and response body so that a duplicate
-- request can return the original outcome rather than a generic 409.
--
-- status   — HTTP status code of the original request (default 202 = Accepted)
-- response — JSON-encoded response body (nullable for in-flight requests)

ALTER TABLE request_idempotency_keys
  ADD COLUMN IF NOT EXISTS status integer NOT NULL DEFAULT 202,
  ADD COLUMN IF NOT EXISTS response text;