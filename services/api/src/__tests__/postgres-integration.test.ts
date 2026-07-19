/**
 * Integration tests for the Postgres-backed stores.
 *
 * These tests run against a real Postgres instance (configured via
 * CB_TEST_DATABASE_URL or defaulting to localhost:5433). They run all
 * migrations, then verify the Postgres code paths of:
 *   - decision log: append → read → verify chain
 *   - artifact store: write → governance event → read
 *   - approval store: create → list → update lifecycle
 *   - collective governance: vote open → cast → resolve lifecycle
 *
 * The test cleans all data tables between tests (preserving schema_migrations).
 * Requires a running Postgres instance — skips automatically if unreachable.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { runMigrations } from "../lib/db-migrate.js";
import { closePool, resetPool, query } from "../lib/db.js";
import { appendEvent, getLog, verifyLog } from "../lib/decision-log.js";
import { writeArtifact, getArtifact, getArtifactHistory } from "../lib/artifact-store.js";
import {
  createApproval,
  getApproval,
  listApprovals,
  updateApproval,
} from "../lib/approval-store.js";
import {
  openVote,
  getVote,
  castBallot,
  resolveVote,
  getVoteBallots,
} from "../lib/collective-governance.js";
import type { GovernanceEvent, ApprovalRecord } from "@commons-board/shared";

const TEST_DB_URL =
  process.env.CB_TEST_DATABASE_URL ?? "postgres://test:test@localhost:5433/commons_board_test";

let dbAvailable = false;
const ORG = "test-org-pg";

function makeEvent(overrides: Partial<GovernanceEvent> = {}): GovernanceEvent {
  return {
    event_id: randomUUID(),
    org_id: ORG,
    event_type: "action_proposed",
    actor: "test-actor",
    artifact_type: null,
    artifact_id: null,
    details: { reason: "integration test" },
    at: new Date().toISOString(),
    ...overrides,
  };
}

const validBusinessProfile = {
  org_id: ORG,
  org_name: "Test Co",
  governance_mode: "business" as const,
  description: "A test organization",
  industry: "Technology",
  primary_domain: "testco.example.com",
  operating_since: null,
  location: { primary: "Remote", regions: [] },
  size: { headcount: 5, member_count: null },
  external_systems: [],
  created_at: new Date().toISOString(),
  schema_version: "1.0",
};

async function ensureOrgRow(orgId: string): Promise<void> {
  await query(
    "INSERT INTO orgs (id, org_name, governance_mode) VALUES ($1, $1, 'business') ON CONFLICT (id) DO NOTHING",
    [orgId]
  );
}

describe("Postgres integration tests", { concurrency: false }, () => {
  before(async () => {
    // Check if the test Postgres is reachable
    const probe = new pg.Pool({ connectionString: TEST_DB_URL, max: 1 });
    try {
      const client = await probe.connect();
      client.release();
      dbAvailable = true;
    } catch {
      dbAvailable = false;
      console.log("  ⏭  Test Postgres not reachable — skipping Postgres integration tests");
      console.log(`     (set CB_TEST_DATABASE_URL or run Postgres at ${TEST_DB_URL})`);
    } finally {
      await probe.end();
    }

    if (!dbAvailable) return;

    process.env.DATABASE_URL = TEST_DB_URL;
    // Ensure governance signing uses dev defaults (not strict)
    delete process.env.CB_GOVERNANCE_STRICT_SIGNING;

    // Run all migrations against the test database
    await runMigrations();
  });

  after(async () => {
    if (dbAvailable) {
      await closePool();
      delete process.env.DATABASE_URL;
    }
  });

  beforeEach(async () => {
    if (!dbAvailable) return;

    // Clean all data tables between tests (preserve schema_migrations)
    const tables = [
      "vote_ballots",
      "contributions",
      "amendments",
      "votes",
      "approval_records",
      "artifacts",
      "decision_log",
      "workspace_settings",
      "governance_events",
      "members",
      "orgs",
    ];
    for (const table of tables) {
      await query(`DELETE FROM ${table}`);
    }
    // Reset the pool to ensure a clean connection state
    resetPool();
  });

  describe("decision log", () => {
    test("append → read → verify chain integrity", async () => {
      if (!dbAvailable) return;

      await ensureOrgRow(ORG);

      // Append 3 events
      const e1 = await appendEvent(makeEvent({ event_type: "action_proposed" }));
      const e2 = await appendEvent(makeEvent({ event_type: "action_executed" }));
      const e3 = await appendEvent(makeEvent({ event_type: "org_activated" }));

      // Read back
      const log = await getLog(ORG);
      assert.equal(log.length, 3, "should have 3 entries");
      assert.equal(log[0].sequence, 0, "first entry sequence 0");
      assert.equal(log[1].sequence, 1, "second entry sequence 1");
      assert.equal(log[2].sequence, 2, "third entry sequence 2");

      // Verify chain links
      assert.equal(log[0].previous_hash, "0".repeat(64), "genesis previous_hash");
      assert.equal(log[1].previous_hash, log[0].entry_hash, "entry 1 links to entry 0");
      assert.equal(log[2].previous_hash, log[1].entry_hash, "entry 2 links to entry 1");

      // Verify returned entries match what was read
      assert.equal(log[0].entry_id, e1.entry_id);
      assert.equal(log[1].entry_id, e2.entry_id);
      assert.equal(log[2].entry_id, e3.entry_id);

      // Verify hash chain integrity
      const verification = await verifyLog(ORG);
      assert.equal(verification.valid, true, "chain should be valid");
      assert.equal(verification.brokenAt, null, "no broken entry");
    });

    test("verifyLog detects a tampered chain", async () => {
      if (!dbAvailable) return;

      await ensureOrgRow(ORG);

      await appendEvent(makeEvent({ event_type: "action_proposed" }));
      await appendEvent(makeEvent({ event_type: "action_executed" }));

      // Tamper: break the chain link at entry 1 by corrupting its previous_hash.
      // Entry 0 still validates (genesis link + hash match), but entry 1's
      // previous_hash no longer matches entry 0's entry_hash.
      await query(
        "UPDATE decision_log SET previous_hash = 'tampered' WHERE org_id = $1 AND sequence = 1",
        [ORG]
      );

      const verification = await verifyLog(ORG);
      assert.equal(verification.valid, false, "chain should be invalid after tampering");
      assert.equal(verification.brokenAt, 1, "broken at entry 1 (previous_hash mismatch)");
    });

    test("event and signed fields round-trip as objects", async () => {
      if (!dbAvailable) return;

      await ensureOrgRow(ORG);

      const event = makeEvent({
        event_type: "action_proposed",
        details: { nested: { deep: "value" }, array: [1, 2, 3] },
      });
      await appendEvent(event);

      const log = await getLog(ORG);
      assert.equal(log.length, 1);
      assert.equal(typeof log[0].event, "object", "event should be an object");
      assert.equal(typeof log[0].signed, "object", "signed should be an object");
      assert.deepEqual(
        (log[0].event as GovernanceEvent).details,
        { nested: { deep: "value" }, array: [1, 2, 3] },
        "nested details should round-trip"
      );
      assert.equal(log[0].signed.algorithm, "HMAC-SHA256", "signed algorithm preserved");
    });
  });

  describe("artifact store", () => {
    test("write → governance event → read", async () => {
      if (!dbAvailable) return;

      await ensureOrgRow(ORG);

      // Write an artifact
      const record = await writeArtifact(ORG, "business_profile", validBusinessProfile, "test-user");
      assert.equal(record.version, 1, "first write is version 1");

      // The write should have emitted a governance event
      const log = await getLog(ORG);
      assert.equal(log.length, 1, "one governance event for the write");
      assert.equal(log[0].event.event_type, "artifact_written");
      assert.equal(log[0].event.artifact_id, record.artifact_id);

      // Read it back
      const fetched = await getArtifact(ORG, "business_profile");
      assert.ok(fetched, "artifact should exist");
      assert.equal(fetched!.version, 1);
      assert.equal(
        (fetched!.payload as { org_name: string }).org_name,
        "Test Co"
      );

      // Verify the data is actually in Postgres (not file-backed)
      const { rows } = await query(
        "SELECT count(*)::int AS cnt FROM artifacts WHERE org_id = $1",
        [ORG]
      );
      assert.equal(rows[0].cnt, 1, "artifact row exists in Postgres");
    });

    test("multiple writes create version history", async () => {
      if (!dbAvailable) return;

      await ensureOrgRow(ORG);

      await writeArtifact(ORG, "business_profile", validBusinessProfile, "user-a");
      const v2 = await writeArtifact(
        ORG,
        "business_profile",
        { ...validBusinessProfile, org_name: "Test Co v2" },
        "user-b"
      );
      assert.equal(v2.version, 2, "second write is version 2");

      const history = await getArtifactHistory(ORG, "business_profile");
      assert.equal(history.length, 2, "two versions in history");
      assert.equal(history[0].version, 1);
      assert.equal(history[1].version, 2);

      const latest = await getArtifact(ORG, "business_profile");
      assert.equal(
        (latest!.payload as { org_name: string }).org_name,
        "Test Co v2"
      );
    });
  });

  describe("approval store", () => {
    function makeApproval(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
      return {
        approval_id: randomUUID(),
        org_id: ORG,
        action_id: randomUUID(),
        action_type: "email_send",
        summary: "Send outreach email",
        risk_score: 30,
        blast_radius: "low",
        status: "pending",
        required_approvers: 1,
        responses: [],
        created_at: new Date().toISOString(),
        resolved_at: null,
        ...overrides,
      };
    }

    test("create → get → list → update lifecycle", async () => {
      if (!dbAvailable) return;

      await ensureOrgRow(ORG);

      // Create
      const approval = makeApproval();
      const created = await createApproval(approval);
      assert.equal(created.approval_id, approval.approval_id);

      // Get
      const fetched = await getApproval(ORG, approval.approval_id);
      assert.ok(fetched, "approval should exist");
      assert.equal(fetched!.status, "pending");
      assert.equal(fetched!.required_approvers, 1);

      // List
      const pending = await listApprovals(ORG, "pending");
      assert.equal(pending.length, 1, "one pending approval");

      // Update (approve)
      const updated = await updateApproval(ORG, approval.approval_id, {
        status: "approved",
        responses: [
          { approver_id: "operator-1", decision: "approve", note: "looks good", at: new Date().toISOString() },
        ],
        resolved_at: new Date().toISOString(),
      });
      assert.ok(updated, "update should return the record");
      assert.equal(updated!.status, "approved");
      assert.equal(updated!.responses.length, 1);
      assert.ok(updated!.resolved_at, "resolved_at should be set");

      // List by status
      const approved = await listApprovals(ORG, "approved");
      assert.equal(approved.length, 1, "one approved approval");
      const stillPending = await listApprovals(ORG, "pending");
      assert.equal(stillPending.length, 0, "zero pending after approval");

      // Verify data is in Postgres
      const { rows } = await query(
        "SELECT count(*)::int AS cnt FROM approval_records WHERE org_id = $1",
        [ORG]
      );
      assert.equal(rows[0].cnt, 1, "approval row in Postgres");
    });

    test("list without status filter returns all", async () => {
      if (!dbAvailable) return;

      await ensureOrgRow(ORG);

      await createApproval(makeApproval({ action_id: "a1" }));
      await createApproval(makeApproval({ action_id: "a2", status: "approved" }));

      const all = await listApprovals(ORG);
      assert.equal(all.length, 2, "all approvals returned");
    });
  });

  describe("collective governance — vote lifecycle", () => {
    test("open → cast → resolve (simple majority)", async () => {
      if (!dbAvailable) return;

      await ensureOrgRow(ORG);

      // members.member_id is UUID — use valid UUIDs
      const m1 = randomUUID();
      const m2 = randomUUID();
      const m3 = randomUUID();

      // Open a vote
      const vote = await openVote({
        orgId: ORG,
        decisionId: "dec-1",
        decisionType: "policy_change",
        method: "simple_majority",
        durationHours: 24,
        actor: "admin-1",
      });
      assert.equal(vote.status, "open");
      assert.equal(vote.method, "simple_majority");

      // Cast ballots: 2 yes, 1 no (3 active members, quorum 0.5 → need 2)
      const r1 = await castBallot({
        orgId: ORG,
        voteId: vote.vote_id,
        memberId: m1,
        choice: "yes",
        activeMemberCount: 3,
      });
      assert.equal(r1.quorum_reached, false, "1 of 3, quorum not yet");

      const r2 = await castBallot({
        orgId: ORG,
        voteId: vote.vote_id,
        memberId: m2,
        choice: "yes",
        activeMemberCount: 3,
      });
      assert.equal(r2.quorum_reached, true, "2 of 3, quorum reached");

      await castBallot({
        orgId: ORG,
        voteId: vote.vote_id,
        memberId: m3,
        choice: "no",
        activeMemberCount: 3,
      });

      // Resolve
      const result = await resolveVote(ORG, vote.vote_id, "admin-1", 3);
      assert.equal(result.outcome, "passed", "2 yes > 1 no, simple majority passes");
      assert.equal(result.vote.status, "passed");

      // Verify vote is in Postgres
      const fetched = await getVote(ORG, vote.vote_id);
      assert.ok(fetched, "vote should exist");
      assert.equal(fetched!.status, "passed");
      assert.ok(fetched!.resolved_at, "resolved_at set");

      // Verify ballots
      const ballots = await getVoteBallots(ORG, vote.vote_id);
      assert.equal(ballots.length, 3, "3 ballots cast");

      // Verify governance events: vote_opened + vote_resolved
      const log = await getLog(ORG);
      const eventTypes = log.map((e) => e.event.event_type);
      assert.ok(eventTypes.includes("vote_opened"), "vote_opened event in log");
      assert.ok(eventTypes.includes("vote_resolved"), "vote_resolved event in log");

      // Verify chain still valid after vote lifecycle
      const verification = await verifyLog(ORG);
      assert.equal(verification.valid, true, "chain valid after vote lifecycle");
    });

    test("castBallot rejects duplicate vote from same member", async () => {
      if (!dbAvailable) return;

      await ensureOrgRow(ORG);

      const dupMember = randomUUID();

      const vote = await openVote({
        orgId: ORG,
        decisionId: "dec-2",
        decisionType: "policy_change",
        method: "simple_majority",
        durationHours: 24,
        actor: "admin-1",
      });

      await castBallot({
        orgId: ORG,
        voteId: vote.vote_id,
        memberId: dupMember,
        choice: "yes",
        activeMemberCount: 2,
      });

      await assert.rejects(
        () =>
          castBallot({
            orgId: ORG,
            voteId: vote.vote_id,
            memberId: dupMember,
            choice: "no",
            activeMemberCount: 2,
          }),
        /already cast a ballot/,
        "should reject duplicate ballot"
      );
    });

    test("consensus vote fails on any no vote", async () => {
      if (!dbAvailable) return;

      await ensureOrgRow(ORG);

      const c1 = randomUUID();
      const c2 = randomUUID();

      const vote = await openVote({
        orgId: ORG,
        decisionId: "dec-3",
        decisionType: "policy_change",
        method: "consensus",
        durationHours: 24,
        actor: "admin-1",
      });

      await castBallot({
        orgId: ORG,
        voteId: vote.vote_id,
        memberId: c1,
        choice: "yes",
        activeMemberCount: 3,
      });
      await castBallot({
        orgId: ORG,
        voteId: vote.vote_id,
        memberId: c2,
        choice: "no",
        activeMemberCount: 3,
      });

      const result = await resolveVote(ORG, vote.vote_id, "admin-1", 3);
      assert.equal(result.outcome, "failed", "consensus fails with any no vote");
    });
  });
});