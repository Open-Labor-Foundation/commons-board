/**
 * Backfill script — migrates file-backed JSON data to Postgres.
 *
 * Reads each JSON file from CB_DATA_DIR, maps to the corresponding table,
 * and inserts idempotently (ON CONFLICT DO NOTHING). Run as:
 *   node --import tsx src/lib/db-backfill.ts
 *
 * Tables backfilled:
 *   decision-log/<orgId>.json  → decision_log
 *   artifacts/<orgId>/<type>.json → artifacts
 *   approvals/<orgId>.json → approval_records
 *   votes/<orgId>.json → votes
 *   vote-ballots/<orgId>.json → vote_ballots
 *   amendments/<orgId>.json → amendments
 *   contributions/<orgId>.json → contributions
 *   settings/<workspaceId>.json → workspace_settings
 *
 * Hash-chain preservation: the decision log backfill preserves sequence,
 * previous_hash, and entry_hash exactly as they are in the JSON — does
 * not recompute. Inserts in sequence order.
 *
 * Prerequisites:
 *   - DATABASE_URL must be set
 *   - Migrations must have been run (npm run migrate)
 *   - orgs rows are upserted idempotently before any FK-dependent inserts
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./env.js";
import { query, closePool } from "./db.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function listJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

/** Ensure an orgs row exists (idempotent). */
async function ensureOrg(orgId: string): Promise<void> {
  await query(
    `INSERT INTO orgs (id, org_name, governance_mode)
     VALUES ($1, $1, 'business')
     ON CONFLICT (id) DO NOTHING`,
    [orgId]
  );
}

/**
 * Ensure a members row exists (idempotent). Members are not stored as JSON
 * files in file-backed mode — they are created on-the-fly via ensureMember()
 * in collective-governance.ts. The backfill must therefore create them before
 * inserting ballots, contributions, or amendments that reference member_id.
 */
async function ensureMember(orgId: string, memberId: string): Promise<void> {
  await ensureOrg(orgId);
  await query(
    `INSERT INTO members (member_id, org_id, display_name, role)
     VALUES ($1, $2, $3, 'member')
     ON CONFLICT (member_id) DO NOTHING`,
    [memberId, orgId, memberId]
  );
}

// ---------------------------------------------------------------------------
// Backfill: decision_log
// ---------------------------------------------------------------------------

interface DecisionLogEntry {
  entry_id: string;
  org_id: string;
  sequence: number;
  event: Record<string, unknown>;
  signed: Record<string, unknown>;
  previous_hash: string;
  entry_hash: string;
  at: string;
}

async function backfillDecisionLog(dataDir: string): Promise<number> {
  const dir = join(dataDir, "decision-log");
  const orgIds = listJsonFiles(dir);
  let count = 0;

  for (const orgId of orgIds) {
    const entries = readJsonFile<DecisionLogEntry[]>(join(dir, `${orgId}.json`));
    if (!entries || entries.length === 0) continue;

    await ensureOrg(orgId);

    // Sort by sequence to preserve chain order.
    entries.sort((a, b) => a.sequence - b.sequence);

    for (const entry of entries) {
      await query(
        `INSERT INTO decision_log
           (entry_id, org_id, sequence, event, signed, previous_hash, entry_hash, at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (entry_id) DO NOTHING`,
        [
          entry.entry_id,
          entry.org_id,
          entry.sequence,
          JSON.stringify(entry.event),
          JSON.stringify(entry.signed),
          entry.previous_hash,
          entry.entry_hash,
          entry.at,
        ]
      );
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Backfill: artifacts
// ---------------------------------------------------------------------------

interface ArtifactRecord {
  artifact_id: string;
  org_id: string;
  type: string;
  version: number;
  payload: Record<string, unknown>;
  created_at: string;
}

async function backfillArtifacts(dataDir: string): Promise<number> {
  const dir = join(dataDir, "artifacts");
  if (!existsSync(dir)) return 0;
  let count = 0;

  const orgIds = readdirSync(dir).filter((d) =>
    statSync(join(dir, d)).isDirectory()
  );

  for (const orgId of orgIds) {
    await ensureOrg(orgId);
    const orgDir = join(dir, orgId);
    const types = listJsonFiles(orgDir);

    for (const type of types) {
      // Each artifact type file may be a single record or an array (history).
      const raw = readJsonFile<ArtifactRecord | ArtifactRecord[]>(
        join(orgDir, `${type}.json`)
      );
      if (!raw) continue;

      const records = Array.isArray(raw) ? raw : [raw];
      for (const rec of records) {
        await query(
          `INSERT INTO artifacts
             (artifact_id, org_id, type, version, payload, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (artifact_id) DO NOTHING`,
          [
            rec.artifact_id,
            rec.org_id,
            rec.type,
            rec.version,
            JSON.stringify(rec.payload),
            rec.created_at,
          ]
        );
        count++;
      }
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Backfill: approval_records
// ---------------------------------------------------------------------------

interface ApprovalRecord {
  approval_id: string;
  org_id: string;
  action_id: string;
  action_type?: string;
  summary?: string;
  risk_score?: number;
  blast_radius?: string;
  status: string;
  required_approvers: number;
  responses: unknown[];
  created_at: string;
  resolved_at: string | null;
}

async function backfillApprovals(dataDir: string): Promise<number> {
  const dir = join(dataDir, "approvals");
  const orgIds = listJsonFiles(dir);
  let count = 0;

  for (const orgId of orgIds) {
    const records = readJsonFile<ApprovalRecord[]>(join(dir, `${orgId}.json`));
    if (!records || records.length === 0) continue;

    await ensureOrg(orgId);

    for (const rec of records) {
      await query(
        `INSERT INTO approval_records
           (approval_id, org_id, action_id, action_type, summary, risk_score,
            blast_radius, status, required_approvers, responses, created_at, resolved_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (approval_id) DO NOTHING`,
        [
          rec.approval_id,
          rec.org_id,
          rec.action_id,
          rec.action_type ?? null,
          rec.summary ?? null,
          rec.risk_score ?? null,
          rec.blast_radius ?? null,
          rec.status,
          rec.required_approvers,
          JSON.stringify(rec.responses),
          rec.created_at,
          rec.resolved_at,
        ]
      );
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Backfill: votes
// ---------------------------------------------------------------------------

interface VoteRecord {
  vote_id: string;
  org_id: string;
  decision_id: string;
  decision_type: string;
  method: string;
  status: string;
  opened_at: string;
  closes_at: string;
  resolved_at: string | null;
  tally: Record<string, unknown>;
  supermajority_threshold?: number;
  quorum_threshold?: number;
}

async function backfillVotes(dataDir: string): Promise<number> {
  const dir = join(dataDir, "votes");
  const orgIds = listJsonFiles(dir);
  let count = 0;

  for (const orgId of orgIds) {
    const records = readJsonFile<VoteRecord[]>(join(dir, `${orgId}.json`));
    if (!records || records.length === 0) continue;

    await ensureOrg(orgId);

    for (const rec of records) {
      await query(
        `INSERT INTO votes
           (vote_id, org_id, decision_id, decision_type, method, status,
            opened_at, closes_at, resolved_at, tally, supermajority_threshold, quorum_threshold)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (vote_id) DO NOTHING`,
        [
          rec.vote_id,
          rec.org_id,
          rec.decision_id,
          rec.decision_type,
          rec.method,
          rec.status,
          rec.opened_at,
          rec.closes_at,
          rec.resolved_at,
          JSON.stringify(rec.tally),
          rec.supermajority_threshold ?? null,
          rec.quorum_threshold ?? null,
        ]
      );
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Backfill: vote_ballots
// ---------------------------------------------------------------------------

interface BallotRecord {
  ballot_id: string;
  vote_id: string;
  member_id: string;
  choice: string;
  cast_at: string;
}

async function backfillBallots(dataDir: string): Promise<number> {
  const dir = join(dataDir, "vote-ballots");
  const orgIds = listJsonFiles(dir);
  let count = 0;

  for (const orgId of orgIds) {
    const records = readJsonFile<BallotRecord[]>(join(dir, `${orgId}.json`));
    if (!records || records.length === 0) continue;

    await ensureOrg(orgId);

    for (const rec of records) {
      // vote_ballots.member_id references members(member_id) — ensure the
      // member row exists before inserting the ballot.
      await ensureMember(orgId, rec.member_id);
      await query(
        `INSERT INTO vote_ballots
           (ballot_id, vote_id, member_id, choice, cast_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (ballot_id) DO NOTHING`,
        [rec.ballot_id, rec.vote_id, rec.member_id, rec.choice, rec.cast_at]
      );
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Backfill: amendments
// ---------------------------------------------------------------------------

interface AmendmentRecord {
  amendment_id: string;
  org_id: string;
  artifact_type: string;
  proposed_by: string | null;
  proposed_payload: Record<string, unknown>;
  status: string;
  notice_until: string | null;
  vote_id: string | null;
  created_at: string;
  applied_at: string | null;
}

async function backfillAmendments(dataDir: string): Promise<number> {
  const dir = join(dataDir, "amendments");
  const orgIds = listJsonFiles(dir);
  let count = 0;

  for (const orgId of orgIds) {
    const records = readJsonFile<AmendmentRecord[]>(join(dir, `${orgId}.json`));
    if (!records || records.length === 0) continue;

    await ensureOrg(orgId);

    for (const rec of records) {
      // amendments.proposed_by references members(member_id) — ensure the
      // member row exists before inserting the amendment (if proposed_by is set).
      if (rec.proposed_by) {
        await ensureMember(orgId, rec.proposed_by);
      }
      await query(
        `INSERT INTO amendments
           (amendment_id, org_id, artifact_type, proposed_by, proposed_payload,
            status, notice_until, vote_id, created_at, applied_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (amendment_id) DO NOTHING`,
        [
          rec.amendment_id,
          rec.org_id,
          rec.artifact_type,
          rec.proposed_by,
          JSON.stringify(rec.proposed_payload),
          rec.status,
          rec.notice_until,
          rec.vote_id,
          rec.created_at,
          rec.applied_at,
        ]
      );
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Backfill: contributions
// ---------------------------------------------------------------------------

interface ContributionRecord {
  contribution_id: string;
  org_id: string;
  member_id: string;
  action_type: string;
  weight: number;
  recorded_at: string;
}

async function backfillContributions(dataDir: string): Promise<number> {
  const dir = join(dataDir, "contributions");
  const orgIds = listJsonFiles(dir);
  let count = 0;

  for (const orgId of orgIds) {
    const records = readJsonFile<ContributionRecord[]>(join(dir, `${orgId}.json`));
    if (!records || records.length === 0) continue;

    await ensureOrg(orgId);

    for (const rec of records) {
      // contributions.member_id references members(member_id) — ensure the
      // member row exists before inserting the contribution.
      await ensureMember(orgId, rec.member_id);
      await query(
        `INSERT INTO contributions
           (contribution_id, org_id, member_id, action_type, weight, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (contribution_id) DO NOTHING`,
        [
          rec.contribution_id,
          rec.org_id,
          rec.member_id,
          rec.action_type,
          rec.weight,
          rec.recorded_at,
        ]
      );
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Backfill: workspace_settings
// ---------------------------------------------------------------------------

interface WorkspaceSettingsRecord {
  workspace_id: string;
  org_name?: string;
  governance_mode?: string;
  active_provider_id: string;
  providers: unknown[];
  rbac: Record<string, unknown>;
  feature_toggles: Record<string, unknown>;
  board_settings?: Record<string, unknown>;
  addin_catalog_url?: string;
  inference_queue?: Record<string, unknown>;
  updated_at: string;
}

async function backfillSettings(dataDir: string): Promise<number> {
  const dir = join(dataDir, "settings");
  const workspaceIds = listJsonFiles(dir);
  let count = 0;

  for (const workspaceId of workspaceIds) {
    const settings = readJsonFile<WorkspaceSettingsRecord>(
      join(dir, `${workspaceId}.json`)
    );
    if (!settings) continue;

    await query(
      `INSERT INTO workspace_settings
         (workspace_id, org_name, governance_mode, active_provider_id,
          providers, rbac, feature_toggles, board_settings,
          addin_catalog_url, inference_queue, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (workspace_id) DO NOTHING`,
      [
        settings.workspace_id,
        settings.org_name ?? null,
        settings.governance_mode ?? null,
        settings.active_provider_id,
        JSON.stringify(settings.providers),
        JSON.stringify(settings.rbac),
        JSON.stringify(settings.feature_toggles),
        settings.board_settings ? JSON.stringify(settings.board_settings) : null,
        settings.addin_catalog_url ?? null,
        settings.inference_queue ? JSON.stringify(settings.inference_queue) : null,
        settings.updated_at,
      ]
    );
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = loadConfig();

  if (!config.databaseUrl.trim()) {
    console.error("DATABASE_URL is not set — cannot backfill to Postgres.");
    process.exit(1);
  }

  const dataDir = config.dataDir;
  console.log(`Backfilling from ${dataDir} to Postgres...`);

  const results: Record<string, number> = {};

  results["decision_log"] = await backfillDecisionLog(dataDir);
  results["artifacts"] = await backfillArtifacts(dataDir);
  results["approval_records"] = await backfillApprovals(dataDir);
  results["votes"] = await backfillVotes(dataDir);
  results["vote_ballots"] = await backfillBallots(dataDir);
  results["amendments"] = await backfillAmendments(dataDir);
  results["contributions"] = await backfillContributions(dataDir);
  results["workspace_settings"] = await backfillSettings(dataDir);

  console.log("\nBackfill complete:");
  for (const [table, count] of Object.entries(results)) {
    console.log(`  ${table}: ${count} rows`);
  }

  await closePool();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});