/**
 * Persistent idempotency store.
 *
 * Dual-backend: uses PostgreSQL when DATABASE_URL is set, falls back to
 * file-backed JSON persistence for local/dev. This replaces the in-memory
 * Map from lib/idempotency.ts, which was process-lifetime only.
 *
 * The request_idempotency_keys table (migration 0006) provides:
 *   (workspace_id, scope, idempotency_key) as PK
 *
 * For the global middleware (no workspace scope), we use workspace_id = "_global".
 */
import { isDatabaseEnabled, query } from "./db.js";
import { readJson, writeJsonAtomic } from "./persistence.js";

export type IdempotencyRecord = {
  workspaceId: string;
  scope: string;
  key: string;
  status: number;
  response?: unknown;
  createdAt: string;
};

const GLOBAL_WORKSPACE = "_global";
const idempotencyFileKey = (workspaceId: string) => `idempotency-keys/${workspaceId}`;

/**
 * Try to register an idempotency key. Returns true if this is a new key
 * (caller should proceed), false if the key already exists (caller should
 * return the stored response).
 *
 * When the database is enabled, uses INSERT ... ON CONFLICT DO NOTHING
 * for an atomic check-and-insert. When using file fallback, does a
 * read-check-write (not atomic across processes, but fine for single-
 * instance local dev).
 */
export async function tryRegisterIdempotency(opts: {
  workspaceId?: string;
  scope: string;
  key: string;
}): Promise<{ accepted: boolean; existing?: IdempotencyRecord }> {
  const workspaceId = opts.workspaceId ?? GLOBAL_WORKSPACE;

  if (isDatabaseEnabled()) {
    const result = await query<{ idempotency_key: string; status: number; response: string | null; created_at: Date }>(
      `INSERT INTO request_idempotency_keys (workspace_id, scope, idempotency_key)
       VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, scope, idempotency_key) DO NOTHING
       RETURNING idempotency_key`,
      [workspaceId, opts.scope, opts.key]
    );

    if (result.rows.length > 0) {
      // Insert succeeded — new key
      return { accepted: true };
    }

    // Key already exists — fetch the existing record
    const existing = await query<{ status: number; response: string | null; created_at: Date }>(
      `SELECT status, response, created_at
       FROM request_idempotency_keys
       WHERE workspace_id = $1 AND scope = $2 AND idempotency_key = $3`,
      [workspaceId, opts.scope, opts.key]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      return {
        accepted: false,
        existing: {
          workspaceId,
          scope: opts.scope,
          key: opts.key,
          status: row.status,
          response: row.response ? JSON.parse(row.response) : undefined,
          createdAt: row.created_at.toISOString()
        }
      };
    }

    // Race condition: row disappeared between INSERT and SELECT
    return { accepted: true };
  }

  // File fallback
  const records = readJson<IdempotencyRecord[]>(idempotencyFileKey(workspaceId), []);
  const existing = records.find((r) => r.scope === opts.scope && r.key === opts.key);
  if (existing) {
    return { accepted: false, existing };
  }

  const record: IdempotencyRecord = {
    workspaceId,
    scope: opts.scope,
    key: opts.key,
    status: 202,
    createdAt: new Date().toISOString()
  };
  writeJsonAtomic(idempotencyFileKey(workspaceId), [...records, record]);
  return { accepted: true };
}

/**
 * Update the stored idempotency record with the final response status
 * and body. Called after the request handler completes.
 */
export async function completeIdempotency(opts: {
  workspaceId?: string;
  scope: string;
  key: string;
  status: number;
  response?: unknown;
}): Promise<void> {
  const workspaceId = opts.workspaceId ?? GLOBAL_WORKSPACE;

  if (isDatabaseEnabled()) {
    await query(
      `UPDATE request_idempotency_keys
       SET status = $4, response = $5
       WHERE workspace_id = $1 AND scope = $2 AND idempotency_key = $3`,
      [
        workspaceId,
        opts.scope,
        opts.key,
        opts.status,
        opts.response !== undefined ? JSON.stringify(opts.response) : null
      ]
    );
    return;
  }

  // File fallback
  const records = readJson<IdempotencyRecord[]>(idempotencyFileKey(workspaceId), []);
  const updated = records.map((r) =>
    r.scope === opts.scope && r.key === opts.key
      ? { ...r, status: opts.status, response: opts.response }
      : r
  );
  writeJsonAtomic(idempotencyFileKey(workspaceId), updated);
}

/**
 * Purge idempotency keys older than the given number of hours.
 * Called periodically by the scheduler to prevent unbounded growth.
 */
export async function purgeOldIdempotencyKeys(maxAgeHours: number): Promise<number> {
  if (isDatabaseEnabled()) {
    const result = await query(
      `DELETE FROM request_idempotency_keys
       WHERE created_at < now() - interval '${maxAgeHours} hours'
       RETURNING idempotency_key`
    );
    return result.rowCount ?? 0;
  }

  // File fallback — purge across all workspaces is not feasible without
  // listing directories; this is a no-op for local dev.
  return 0;
}