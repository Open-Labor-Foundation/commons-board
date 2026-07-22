/**
 * The approval store — operator queue for actions requiring human sign-off.
 *
 * Invariants:
 *  - Approvals are append-only on create; status transitions go pending →
 *    approved/rejected.
 *  - Responses accumulate as a JSONB array; an approval is resolved when
 *    approve count ≥ required_approvers (or on any reject).
 *  - Row-level operations (INSERT / UPDATE) avoid the read-modify-write
 *    race that the file-store's whole-array write has.
 *
 * Uses PostgreSQL when DATABASE_URL is configured; falls back to the
 * file-backed store otherwise. All functions are async.
 */
import type { ApprovalRecord } from "@commons-board/shared";
import { readJson, writeJsonAtomic } from "./persistence.js";
import { isDatabaseEnabled, query } from "./db.js";

function key(orgId: string): string {
  return `approvals/${orgId}`;
}

function loadFile(orgId: string): ApprovalRecord[] {
  return readJson<ApprovalRecord[]>(key(orgId), []);
}

function saveFile(orgId: string, records: ApprovalRecord[]): void {
  writeJsonAtomic(key(orgId), records);
}

/** Map a DB row to an ApprovalRecord. */
function rowToRecord(r: Record<string, unknown>): ApprovalRecord {
  return {
    approval_id: String(r.approval_id),
    org_id: String(r.org_id),
    action_id: String(r.action_id),
    action_type: r.action_type != null ? String(r.action_type) : undefined,
    summary: r.summary != null ? String(r.summary) : undefined,
    risk_score: r.risk_score != null ? Number(r.risk_score) : undefined,
    blast_radius: (r.blast_radius as ApprovalRecord["blast_radius"]) ?? undefined,
    status: String(r.status) as ApprovalRecord["status"],
    required_approvers: Number(r.required_approvers),
    responses: Array.isArray(r.responses) ? (r.responses as ApprovalRecord["responses"]) : [],
    created_at: String(r.created_at),
    resolved_at: r.resolved_at != null ? String(r.resolved_at) : null,
  };
}

/** Create a new approval record (INSERT). Returns the persisted record. */
export async function createApproval(record: ApprovalRecord): Promise<ApprovalRecord> {
  if (isDatabaseEnabled()) {
    await query(
      `INSERT INTO approval_records
         (approval_id, org_id, action_id, action_type, summary, risk_score,
          blast_radius, status, required_approvers, responses, created_at, resolved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        record.approval_id,
        record.org_id,
        record.action_id,
        record.action_type ?? null,
        record.summary ?? null,
        record.risk_score ?? null,
        record.blast_radius ?? null,
        record.status,
        record.required_approvers,
        JSON.stringify(record.responses),
        record.created_at,
        record.resolved_at,
      ]
    );
    return record;
  }
  const all = loadFile(record.org_id);
  all.push(record);
  saveFile(record.org_id, all);
  return record;
}

/** Get a single approval by ID, or null if not found. */
export async function getApproval(orgId: string, approvalId: string): Promise<ApprovalRecord | null> {
  if (isDatabaseEnabled()) {
    const { rows } = await query(
      `SELECT approval_id, org_id, action_id, action_type, summary, risk_score,
              blast_radius, status, required_approvers, responses, created_at, resolved_at
       FROM approval_records
       WHERE org_id = $1 AND approval_id = $2`,
      [orgId, approvalId]
    );
    if (rows.length === 0) return null;
    return rowToRecord(rows[0]);
  }
  return loadFile(orgId).find((a) => a.approval_id === approvalId) ?? null;
}

/** List approvals for an org, optionally filtered by status. */
export async function listApprovals(
  orgId: string,
  status?: ApprovalRecord["status"]
): Promise<ApprovalRecord[]> {
  if (isDatabaseEnabled()) {
    if (status) {
      const { rows } = await query(
        `SELECT approval_id, org_id, action_id, action_type, summary, risk_score,
                blast_radius, status, required_approvers, responses, created_at, resolved_at
         FROM approval_records
         WHERE org_id = $1 AND status = $2
         ORDER BY created_at`,
        [orgId, status]
      );
      return rows.map(rowToRecord);
    }
    const { rows } = await query(
      `SELECT approval_id, org_id, action_id, action_type, summary, risk_score,
              blast_radius, status, required_approvers, responses, created_at, resolved_at
       FROM approval_records
       WHERE org_id = $1
       ORDER BY created_at`,
      [orgId]
    );
    return rows.map(rowToRecord);
  }
  const all = loadFile(orgId);
  return status ? all.filter((a) => a.status === status) : all;
}

/** Update an approval's status and responses (UPDATE). Returns the updated record or null. */
export async function updateApproval(
  orgId: string,
  approvalId: string,
  updates: { status: ApprovalRecord["status"]; responses: ApprovalRecord["responses"]; resolved_at: string | null }
): Promise<ApprovalRecord | null> {
  if (isDatabaseEnabled()) {
    const { rows } = await query(
      `UPDATE approval_records
       SET status = $3, responses = $4, resolved_at = $5
       WHERE org_id = $1 AND approval_id = $2
       RETURNING approval_id, org_id, action_id, action_type, summary, risk_score,
                 blast_radius, status, required_approvers, responses, created_at, resolved_at`,
      [orgId, approvalId, updates.status, JSON.stringify(updates.responses), updates.resolved_at]
    );
    if (rows.length === 0) return null;
    return rowToRecord(rows[0]);
  }
  const all = loadFile(orgId);
  const idx = all.findIndex((a) => a.approval_id === approvalId);
  if (idx < 0) return null;
  all[idx] = { ...all[idx], ...updates };
  saveFile(orgId, all);
  return all[idx];
}