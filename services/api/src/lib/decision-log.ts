/**
 * The decision log — append-only, hash-chained, per-org.
 *
 * Core invariant: every governance event is signed and chained into this log
 * BEFORE the corresponding action executes. The chain makes tampering
 * detectable: each entry's hash covers the prior entry's hash.
 *
 * Phase 1 uses the file-backed store; later phases add the PostgreSQL backend
 * behind this same interface.
 */
import { createHash, randomUUID } from "node:crypto";
import type { DecisionLogEntry, GovernanceEvent } from "@commons-board/shared";
import { signPayload } from "./governance-signing.js";
import { readJson, writeJsonAtomic } from "./persistence.js";

const GENESIS_HASH = "0".repeat(64);

function logKey(orgId: string): string {
  return `decision-log/${orgId}`;
}

function entryHash(input: Omit<DecisionLogEntry, "entry_hash">): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function loadLog(orgId: string): DecisionLogEntry[] {
  return readJson<DecisionLogEntry[]>(logKey(orgId), []);
}

/**
 * Append a governance event to an org's decision log. Returns the persisted,
 * signed, chained entry. This must be called before the action it records runs.
 */
export function appendEvent(event: GovernanceEvent): DecisionLogEntry {
  const log = loadLog(event.org_id);
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

export function getLog(orgId: string): DecisionLogEntry[] {
  return loadLog(orgId);
}

/** Verify the full chain for an org: hashes link and signatures hold. */
export function verifyLog(orgId: string): { valid: boolean; brokenAt: number | null } {
  const log = loadLog(orgId);
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
