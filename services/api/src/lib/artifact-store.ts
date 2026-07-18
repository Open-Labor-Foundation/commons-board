/**
 * The artifact store — versioned, schema-validated, governance-recorded.
 *
 * Invariants:
 *  - An artifact that fails JSON Schema validation is never persisted.
 *  - Every write creates a new version; prior versions are retained.
 *  - Every write emits an `artifact_written` governance event into the
 *    decision log (signed + hash-chained) before it is considered durable.
 *  - Agents never call write paths; only governed flows do.
 *
 * Uses PostgreSQL when DATABASE_URL is configured; falls back to the file-backed
 * store otherwise. All functions are async.
 */
import { randomUUID } from "node:crypto";
import type { ArtifactType, GovernanceEvent } from "@commons-board/shared";
import { validateArtifact } from "./schema-validator.js";
import { appendEvent } from "./decision-log.js";
import { readJson, writeJsonAtomic } from "./persistence.js";
import { isDatabaseEnabled, query } from "./db.js";

export interface ArtifactRecord {
  artifact_id: string;
  org_id: string;
  type: ArtifactType;
  version: number;
  payload: unknown;
  created_at: string;
}

function key(orgId: string, type: ArtifactType): string {
  return `artifacts/${orgId}/${type}`;
}

function loadVersionsFile(orgId: string, type: ArtifactType): ArtifactRecord[] {
  return readJson<ArtifactRecord[]>(key(orgId, type), []);
}

export class ArtifactValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`artifact failed schema validation: ${errors.join("; ")}`);
    this.name = "ArtifactValidationError";
  }
}

/**
 * Write a new version of an artifact. Validates, persists, and records a
 * signed governance event. Throws ArtifactValidationError if invalid.
 */
export async function writeArtifact(
  orgId: string,
  type: ArtifactType,
  payload: unknown,
  actor: string
): Promise<ArtifactRecord> {
  const result = validateArtifact(type, payload);
  if (!result.valid) {
    throw new ArtifactValidationError(result.errors);
  }

  let version: number;
  let record: ArtifactRecord;

  if (isDatabaseEnabled()) {
    // Determine next version atomically
    const { rows } = await query(
      "SELECT COALESCE(MAX(version), 0) AS max_ver FROM artifacts WHERE org_id = $1 AND type = $2",
      [orgId, type]
    );
    version = (rows[0].max_ver as number) + 1;
    record = {
      artifact_id: randomUUID(),
      org_id: orgId,
      type,
      version,
      payload,
      created_at: new Date().toISOString()
    };
  } else {
    const versions = loadVersionsFile(orgId, type);
    version = versions.length + 1;
    record = {
      artifact_id: randomUUID(),
      org_id: orgId,
      type,
      version,
      payload,
      created_at: new Date().toISOString()
    };
  }

  // Governance first: record the write before it is durable.
  const event: GovernanceEvent = {
    event_id: randomUUID(),
    org_id: orgId,
    event_type: "artifact_written",
    actor,
    artifact_type: type,
    artifact_id: record.artifact_id,
    details: { version: record.version },
    at: record.created_at
  };
  await appendEvent(event);

  if (isDatabaseEnabled()) {
    await query(
      `INSERT INTO artifacts (artifact_id, org_id, type, version, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        record.artifact_id,
        record.org_id,
        record.type,
        record.version,
        JSON.stringify(record.payload),
        record.created_at
      ]
    );
  } else {
    const versions = loadVersionsFile(orgId, type);
    versions.push(record);
    writeJsonAtomic(key(orgId, type), versions);
  }
  return record;
}

/** Get the current (latest) version of an artifact, or null if none. */
export async function getArtifact(orgId: string, type: ArtifactType): Promise<ArtifactRecord | null> {
  if (isDatabaseEnabled()) {
    const { rows } = await query(
      "SELECT artifact_id, org_id, type, version, payload, created_at FROM artifacts WHERE org_id = $1 AND type = $2 ORDER BY version DESC LIMIT 1",
      [orgId, type]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      artifact_id: r.artifact_id,
      org_id: r.org_id,
      type: r.type,
      version: r.version,
      payload: r.payload,
      created_at: r.created_at
    } as ArtifactRecord;
  }
  const versions = loadVersionsFile(orgId, type);
  return versions.at(-1) ?? null;
}

/** Get the full version history of an artifact, oldest first. */
export async function getArtifactHistory(orgId: string, type: ArtifactType): Promise<ArtifactRecord[]> {
  if (isDatabaseEnabled()) {
    const { rows } = await query(
      "SELECT artifact_id, org_id, type, version, payload, created_at FROM artifacts WHERE org_id = $1 AND type = $2 ORDER BY version",
      [orgId, type]
    );
    return rows.map((r) => ({
      artifact_id: r.artifact_id,
      org_id: r.org_id,
      type: r.type,
      version: r.version,
      payload: r.payload,
      created_at: r.created_at
    })) as ArtifactRecord[];
  }
  return loadVersionsFile(orgId, type);
}
