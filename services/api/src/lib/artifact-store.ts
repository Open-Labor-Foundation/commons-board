/**
 * The artifact store — versioned, schema-validated, governance-recorded.
 *
 * Invariants:
 *  - An artifact that fails JSON Schema validation is never persisted.
 *  - Every write creates a new version; prior versions are retained.
 *  - Every write emits an `artifact_written` governance event into the
 *    decision log (signed + hash-chained) before it is considered durable.
 *  - Agents never call write paths; only governed flows do.
 */
import { randomUUID } from "node:crypto";
import type { ArtifactType, GovernanceEvent } from "@commons-board/shared";
import { validateArtifact } from "./schema-validator.js";
import { appendEvent } from "./decision-log.js";
import { readJson, writeJsonAtomic } from "./persistence.js";

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

function loadVersions(orgId: string, type: ArtifactType): ArtifactRecord[] {
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
export function writeArtifact(
  orgId: string,
  type: ArtifactType,
  payload: unknown,
  actor: string
): ArtifactRecord {
  const result = validateArtifact(type, payload);
  if (!result.valid) {
    throw new ArtifactValidationError(result.errors);
  }

  const versions = loadVersions(orgId, type);
  const record: ArtifactRecord = {
    artifact_id: randomUUID(),
    org_id: orgId,
    type,
    version: versions.length + 1,
    payload,
    created_at: new Date().toISOString()
  };

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
  appendEvent(event);

  versions.push(record);
  writeJsonAtomic(key(orgId, type), versions);
  return record;
}

/** Get the current (latest) version of an artifact, or null if none. */
export function getArtifact(orgId: string, type: ArtifactType): ArtifactRecord | null {
  const versions = loadVersions(orgId, type);
  return versions.at(-1) ?? null;
}

/** Get the full version history of an artifact, oldest first. */
export function getArtifactHistory(orgId: string, type: ArtifactType): ArtifactRecord[] {
  return loadVersions(orgId, type);
}
