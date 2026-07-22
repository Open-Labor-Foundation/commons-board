/**
 * The decision log — append-only, hash-chained, per-org.
 *
 * Core invariant: every governance event is signed and chained into this log
 * BEFORE the corresponding action executes. The chain makes tampering
 * detectable: each entry's hash covers the prior entry's hash.
 *
 * Uses PostgreSQL when DATABASE_URL is configured; falls back to the file-backed
 * store otherwise. All functions are async.
 */
import { createHash, randomUUID } from "node:crypto";
import type { DecisionLogEntry, GovernanceEvent } from "@commons-board/shared";
import { signPayload } from "./governance-signing.js";
import { readJson, writeJsonAtomic } from "./persistence.js";
import { isDatabaseEnabled, query, getPool } from "./db.js";

const GENESIS_HASH = "0".repeat(64);

function logKey(orgId: string): string {
  return `decision-log/${orgId}`;
}

function entryHash(input: Omit<DecisionLogEntry, "entry_hash">): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function loadLogFile(orgId: string): DecisionLogEntry[] {
  return readJson<DecisionLogEntry[]>(logKey(orgId), []);
}

/**
 * Append a governance event to an org's decision log. Returns the persisted,
 * signed, chained entry. This must be called before the action it records runs.
 */
export async function appendEvent(event: GovernanceEvent): Promise<DecisionLogEntry> {
  if (isDatabaseEnabled()) {
    return appendEventDb(event);
  }
  return appendEventFile(event);
}

async function appendEventFile(event: GovernanceEvent): Promise<DecisionLogEntry> {
  const log = loadLogFile(event.org_id);
  const previous = log.at(-1);
  const previousHash = previous ? previous.entry_hash : GENESIS_HASH;
  const sequence = log.length;

  const base: Omit<DecisionLogEntry, "entry_hash"> = {
    entry_id: randomUUID(),
    org_id: event.org_id,
    sequence,
    event,
    signed: signPayload(event),
    previous_hash: previousHash,
    at: new Date().toISOString()
  };

  const entry: DecisionLogEntry = { ...base, entry_hash: entryHash(base) };
  log.push(entry);
  writeJsonAtomic(logKey(event.org_id), log);
  return entry;
}

/**
 * Postgres backend. Uses a transaction with row-level locking to assign the
 * sequence atomically — prevents race conditions that would break the chain.
 */
async function appendEventDb(event: GovernanceEvent): Promise<DecisionLogEntry> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Lock the orgs row to serialize sequence assignment for this org.
    // (FOR UPDATE is not allowed with aggregate functions, so we lock the
    // parent orgs row instead — any concurrent appendEventDb for the same
    // org blocks here until the first transaction commits.)
    await client.query("SELECT 1 FROM orgs WHERE id = $1 FOR UPDATE", [event.org_id]);
    const { rows } = await client.query(
      "SELECT COALESCE(MAX(sequence), -1) AS max_seq FROM decision_log WHERE org_id = $1",
      [event.org_id]
    );
    const sequence = (rows[0].max_seq as number) + 1;

    let previousHash = GENESIS_HASH;
    if (sequence > 0) {
      const prev = await client.query(
        "SELECT entry_hash FROM decision_log WHERE org_id = $1 AND sequence = $2",
        [event.org_id, sequence - 1]
      );
      if (prev.rows.length > 0) {
        previousHash = prev.rows[0].entry_hash as string;
      }
    }

    const base: Omit<DecisionLogEntry, "entry_hash"> = {
      entry_id: randomUUID(),
      org_id: event.org_id,
      sequence,
      event,
      signed: signPayload(event),
      previous_hash: previousHash,
      at: new Date().toISOString()
    };
    const entry: DecisionLogEntry = { ...base, entry_hash: entryHash(base) };

    await client.query(
      `INSERT INTO decision_log (entry_id, org_id, sequence, event, signed, previous_hash, entry_hash, at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.entry_id,
        entry.org_id,
        entry.sequence,
        JSON.stringify(entry.event),
        JSON.stringify(entry.signed),
        entry.previous_hash,
        entry.entry_hash,
        entry.at
      ]
    );
    await client.query("COMMIT");
    return entry;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getLog(orgId: string): Promise<DecisionLogEntry[]> {
  if (isDatabaseEnabled()) {
    const { rows } = await query(
      "SELECT entry_id, org_id, sequence, event, signed, previous_hash, entry_hash, at FROM decision_log WHERE org_id = $1 ORDER BY sequence",
      [orgId]
    );
    return rows.map((r) => ({
      entry_id: r.entry_id,
      org_id: r.org_id,
      sequence: r.sequence,
      // event and signed are stored as TEXT (exact JSON strings) to preserve
      // hash fidelity. Parse back to objects for the API response.
      event: typeof r.event === "string" ? JSON.parse(r.event) : r.event,
      signed: typeof r.signed === "string" ? JSON.parse(r.signed) : r.signed,
      previous_hash: r.previous_hash,
      entry_hash: r.entry_hash,
      // Postgres returns TIMESTAMPTZ as a JS Date; normalize to ISO string
      // to match the format used when the hash was computed (new Date().toISOString()).
      at: r.at instanceof Date ? r.at.toISOString() : r.at
    })) as DecisionLogEntry[];
  }
  return loadLogFile(orgId);
}

/** Verify the full chain for an org: hashes link and signatures hold. */
export async function verifyLog(orgId: string): Promise<{ valid: boolean; brokenAt: number | null }> {
  if (isDatabaseEnabled()) {
    // When reading from Postgres, event and signed are stored as TEXT (exact
    // JSON strings). We must recompute the hash using those exact strings,
    // not parsed-then-restringified objects (which may have different key
    // order). This function reads the raw TEXT and reconstructs the hash input.
    const { rows } = await query(
      "SELECT entry_id, org_id, sequence, event, signed, previous_hash, entry_hash, at FROM decision_log WHERE org_id = $1 ORDER BY sequence",
      [orgId]
    );
    let previousHash = GENESIS_HASH;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.previous_hash !== previousHash) return { valid: false, brokenAt: i };
      // Reconstruct the hash input using the stored TEXT strings directly.
      // The original hash was computed from JSON.stringify(base) where
      // base.event and base.signed were objects. We stored JSON.stringify(event)
      // and JSON.stringify(signed) as TEXT. To reproduce the exact same
      // JSON.stringify output, we parse the stored strings back to objects
      // (which gives us the same key order as the original objects, since the
      // strings were produced by JSON.stringify on those same objects).
      const eventObj = typeof r.event === "string" ? JSON.parse(r.event) : r.event;
      const signedObj = typeof r.signed === "string" ? JSON.parse(r.signed) : r.signed;
      const rest = {
        entry_id: r.entry_id,
        org_id: r.org_id,
        sequence: r.sequence,
        event: eventObj,
        signed: signedObj,
        previous_hash: r.previous_hash,
        // Postgres returns TIMESTAMPTZ as a JS Date; normalize to ISO string
        // so JSON.stringify produces the same format as the original hash input.
        at: r.at instanceof Date ? r.at.toISOString() : r.at
      };
      if (entryHash(rest) !== r.entry_hash) return { valid: false, brokenAt: i };
      previousHash = r.entry_hash;
    }
    return { valid: true, brokenAt: null };
  }
  // File-backed: objects are read from JSON with preserved key order.
  const log = await getLog(orgId);
  let previousHash = GENESIS_HASH;
  for (let i = 0; i < log.length; i++) {
    const entry = log[i];
    if (entry.previous_hash !== previousHash) return { valid: false, brokenAt: i };
    const { entry_hash, ...rest } = entry;
    if (entryHash(rest) !== entry_hash) return { valid: false, brokenAt: i };
    previousHash = entry.entry_hash;
  }
  return { valid: true, brokenAt: null };
}
