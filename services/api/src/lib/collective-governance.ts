/**
 * Collective governance — vote lifecycle and amendment workflow.
 *
 * Vote lifecycle:
 *   open → cast ballots → resolve (at quorum or deadline)
 *   Status: 'open' | 'passed' | 'failed' | 'cancelled'
 *
 * Amendment workflow:
 *   proposed → noticed (notice period) → voting → applied | rejected
 *
 * Contribution tracking: records member participation for equity distribution.
 *
 * Uses PostgreSQL when DATABASE_URL is configured; falls back to the
 * file-backed store otherwise. All functions are async.
 */
import { randomUUID } from "node:crypto";
import { appendEvent } from "./decision-log.js";
import { readJson, writeJsonAtomic } from "./persistence.js";
import { isDatabaseEnabled, query } from "./db.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface VoteRecord {
  vote_id: string;
  org_id: string;
  decision_id: string;
  decision_type: string;
  method: "simple_majority" | "supermajority" | "consensus" | "ranked_choice";
  status: "open" | "passed" | "failed" | "cancelled";
  opened_at: string;
  closes_at: string;
  resolved_at: string | null;
  tally: Record<string, number>;
  supermajority_threshold?: number;
  quorum_threshold?: number;
}

export interface BallotRecord {
  ballot_id: string;
  vote_id: string;
  member_id: string;
  choice: string;
  cast_at: string;
}

export interface AmendmentRecord {
  amendment_id: string;
  org_id: string;
  artifact_type: string;
  proposed_by: string;
  proposed_payload: Record<string, unknown>;
  status: "proposed" | "noticed" | "voting" | "applied" | "rejected";
  notice_until: string | null;
  vote_id: string | null;
  created_at: string;
  applied_at: string | null;
}

export interface ContributionRecord {
  contribution_id: string;
  org_id: string;
  member_id: string;
  action_type: string;
  weight: number;
  recorded_at: string;
}

// ── Persistence helpers ────────────────────────────────────────────────────

function votesKey(orgId: string) { return `votes/${orgId}`; }
function ballotsKey(orgId: string) { return `vote-ballots/${orgId}`; }
function amendmentsKey(orgId: string) { return `amendments/${orgId}`; }
function contributionsKey(orgId: string) { return `contributions/${orgId}`; }

function loadVotesFile(orgId: string): VoteRecord[] {
  return readJson<VoteRecord[]>(votesKey(orgId), []);
}
function saveVotesFile(orgId: string, v: VoteRecord[]): void {
  writeJsonAtomic(votesKey(orgId), v);
}
function loadBallotsFile(orgId: string): BallotRecord[] {
  return readJson<BallotRecord[]>(ballotsKey(orgId), []);
}
function saveBallotsFile(orgId: string, b: BallotRecord[]): void {
  writeJsonAtomic(ballotsKey(orgId), b);
}

// ── FK prerequisite helpers ────────────────────────────────────────────────

/**
 * Ensure an orgs row exists for the given orgId. The orgs table is the FK
 * target for votes, amendments, contributions, and decision_log. Idempotent.
 */
async function ensureOrg(orgId: string): Promise<void> {
  if (!isDatabaseEnabled()) return;
  await query(
    "INSERT INTO orgs (id, org_name, governance_mode) VALUES ($1, $1, 'business') ON CONFLICT (id) DO NOTHING",
    [orgId]
  );
}

/**
 * Ensure a members row exists for the given memberId. The members table is the
 * FK target for vote_ballots.member_id, contributions.member_id, and
 * amendments.proposed_by. Idempotent. Uses a stable display_name derived from
 * the id since the members table requires one.
 */
async function ensureMember(orgId: string, memberId: string): Promise<void> {
  if (!isDatabaseEnabled()) return;
  await ensureOrg(orgId);
  await query(
    "INSERT INTO members (member_id, org_id, display_name, role) VALUES ($1, $2, $3, 'member') ON CONFLICT (member_id) DO NOTHING",
    [memberId, orgId, memberId]
  );
}

// ── Row mappers ────────────────────────────────────────────────────────────

function voteRowToRecord(r: Record<string, unknown>): VoteRecord {
  return {
    vote_id: String(r.vote_id),
    org_id: String(r.org_id),
    decision_id: String(r.decision_id),
    decision_type: String(r.decision_type),
    method: String(r.method) as VoteRecord["method"],
    status: String(r.status) as VoteRecord["status"],
    opened_at: String(r.opened_at),
    closes_at: String(r.closes_at),
    resolved_at: r.resolved_at != null ? String(r.resolved_at) : null,
    tally: (r.tally as Record<string, number>) ?? {},
    supermajority_threshold: r.supermajority_threshold != null ? Number(r.supermajority_threshold) : undefined,
    quorum_threshold: r.quorum_threshold != null ? Number(r.quorum_threshold) : undefined,
  };
}

function ballotRowToRecord(r: Record<string, unknown>): BallotRecord {
  return {
    ballot_id: String(r.ballot_id),
    vote_id: String(r.vote_id),
    member_id: String(r.member_id),
    choice: String(r.choice),
    cast_at: String(r.cast_at),
  };
}

function amendmentRowToRecord(r: Record<string, unknown>): AmendmentRecord {
  return {
    amendment_id: String(r.amendment_id),
    org_id: String(r.org_id),
    artifact_type: String(r.artifact_type),
    proposed_by: r.proposed_by != null ? String(r.proposed_by) : "",
    proposed_payload: (r.proposed_payload as Record<string, unknown>) ?? {},
    status: String(r.status) as AmendmentRecord["status"],
    notice_until: r.notice_until != null ? String(r.notice_until) : null,
    vote_id: r.vote_id != null ? String(r.vote_id) : null,
    created_at: String(r.created_at),
    applied_at: r.applied_at != null ? String(r.applied_at) : null,
  };
}

function contributionRowToRecord(r: Record<string, unknown>): ContributionRecord {
  return {
    contribution_id: String(r.contribution_id),
    org_id: String(r.org_id),
    member_id: String(r.member_id),
    action_type: String(r.action_type),
    weight: Number(r.weight),
    recorded_at: String(r.recorded_at),
  };
}

// ── Vote API ───────────────────────────────────────────────────────────────

export async function openVote(opts: {
  orgId: string;
  decisionId: string;
  decisionType: string;
  method: VoteRecord["method"];
  durationHours: number;
  actor: string;
  quorumThreshold?: number;
  supermajorityThreshold?: number;
}): Promise<VoteRecord> {
  const now = new Date();
  const closes = new Date(now.getTime() + opts.durationHours * 3600 * 1000);
  const vote: VoteRecord = {
    vote_id: randomUUID(),
    org_id: opts.orgId,
    decision_id: opts.decisionId,
    decision_type: opts.decisionType,
    method: opts.method,
    status: "open",
    opened_at: now.toISOString(),
    closes_at: closes.toISOString(),
    resolved_at: null,
    tally: {},
    quorum_threshold: opts.quorumThreshold,
    supermajority_threshold: opts.supermajorityThreshold
  };

  // Governance first: record the event before the vote is durable.
  await appendEvent({
    event_id: randomUUID(),
    org_id: opts.orgId,
    event_type: "vote_opened",
    actor: opts.actor,
    artifact_type: null,
    artifact_id: null,
    details: { vote_id: vote.vote_id, decision_id: opts.decisionId, decision_type: opts.decisionType, method: opts.method },
    at: vote.opened_at
  });

  if (isDatabaseEnabled()) {
    await ensureOrg(opts.orgId);
    await query(
      `INSERT INTO votes
         (vote_id, org_id, decision_id, decision_type, method, status,
          opened_at, closes_at, resolved_at, tally, supermajority_threshold, quorum_threshold)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        vote.vote_id,
        vote.org_id,
        vote.decision_id,
        vote.decision_type,
        vote.method,
        vote.status,
        vote.opened_at,
        vote.closes_at,
        vote.resolved_at,
        JSON.stringify(vote.tally),
        vote.supermajority_threshold ?? null,
        vote.quorum_threshold ?? null,
      ]
    );
  } else {
    const votes = loadVotesFile(opts.orgId);
    votes.push(vote);
    saveVotesFile(opts.orgId, votes);
  }
  return vote;
}

export async function getVote(orgId: string, voteId: string): Promise<VoteRecord | null> {
  if (isDatabaseEnabled()) {
    const { rows } = await query(
      `SELECT vote_id, org_id, decision_id, decision_type, method, status,
              opened_at, closes_at, resolved_at, tally, supermajority_threshold, quorum_threshold
       FROM votes WHERE org_id = $1 AND vote_id = $2`,
      [orgId, voteId]
    );
    if (rows.length === 0) return null;
    return voteRowToRecord(rows[0]);
  }
  return loadVotesFile(orgId).find((v) => v.vote_id === voteId) ?? null;
}

export async function listVotes(orgId: string, status?: VoteRecord["status"]): Promise<VoteRecord[]> {
  if (isDatabaseEnabled()) {
    if (status) {
      const { rows } = await query(
        `SELECT vote_id, org_id, decision_id, decision_type, method, status,
                opened_at, closes_at, resolved_at, tally, supermajority_threshold, quorum_threshold
         FROM votes WHERE org_id = $1 AND status = $2 ORDER BY opened_at`,
        [orgId, status]
      );
      return rows.map(voteRowToRecord);
    }
    const { rows } = await query(
      `SELECT vote_id, org_id, decision_id, decision_type, method, status,
              opened_at, closes_at, resolved_at, tally, supermajority_threshold, quorum_threshold
       FROM votes WHERE org_id = $1 ORDER BY opened_at`,
      [orgId]
    );
    return rows.map(voteRowToRecord);
  }
  const all = loadVotesFile(orgId);
  return status ? all.filter((v) => v.status === status) : all;
}

export interface CastResult {
  ballot: BallotRecord;
  vote: VoteRecord;
  quorum_reached: boolean;
}

export async function castBallot(opts: {
  orgId: string;
  voteId: string;
  memberId: string;
  choice: string;
  activeMemberCount: number;
}): Promise<CastResult> {
  // Load + validate the vote
  const vote = await getVote(opts.orgId, opts.voteId);
  if (!vote) throw new Error(`vote ${opts.voteId} not found`);
  if (vote.status !== "open") throw new Error(`vote is ${vote.status}, not open`);
  if (new Date(vote.closes_at) < new Date()) throw new Error("vote has expired");

  // Check for an existing ballot (one per member per vote)
  if (isDatabaseEnabled()) {
    const { rows } = await query(
      "SELECT ballot_id FROM vote_ballots WHERE vote_id = $1 AND member_id = $2",
      [opts.voteId, opts.memberId]
    );
    if (rows.length > 0) {
      throw new Error(`member ${opts.memberId} has already cast a ballot on vote ${opts.voteId}`);
    }
  } else {
    const existing = loadBallotsFile(opts.orgId).find((b) => b.vote_id === opts.voteId && b.member_id === opts.memberId);
    if (existing) throw new Error(`member ${opts.memberId} has already cast a ballot on vote ${opts.voteId}`);
  }

  const ballot: BallotRecord = {
    ballot_id: randomUUID(),
    vote_id: opts.voteId,
    member_id: opts.memberId,
    choice: opts.choice,
    cast_at: new Date().toISOString()
  };

  // Persist the ballot
  if (isDatabaseEnabled()) {
    await ensureMember(opts.orgId, opts.memberId);
    await query(
      `INSERT INTO vote_ballots (ballot_id, vote_id, member_id, choice, cast_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [ballot.ballot_id, ballot.vote_id, ballot.member_id, ballot.choice, ballot.cast_at]
    );
  } else {
    const ballots = loadBallotsFile(opts.orgId);
    ballots.push(ballot);
    saveBallotsFile(opts.orgId, ballots);
  }

  // Update tally on the vote
  vote.tally[opts.choice] = (vote.tally[opts.choice] ?? 0) + 1;
  const totalCast = Object.values(vote.tally).reduce((a, b) => a + b, 0);
  const quorumFraction = vote.quorum_threshold ?? 0.5;
  const quorumReached = totalCast >= Math.ceil(opts.activeMemberCount * quorumFraction);

  if (isDatabaseEnabled()) {
    await query(
      "UPDATE votes SET tally = $3 WHERE org_id = $1 AND vote_id = $2",
      [opts.orgId, opts.voteId, JSON.stringify(vote.tally)]
    );
  } else {
    const votes = loadVotesFile(opts.orgId);
    const voteIdx = votes.findIndex((v) => v.vote_id === opts.voteId);
    votes[voteIdx] = vote;
    saveVotesFile(opts.orgId, votes);
  }

  return { ballot, vote, quorum_reached: quorumReached };
}

export interface ResolveResult {
  vote: VoteRecord;
  outcome: "passed" | "failed";
}

export async function resolveVote(orgId: string, voteId: string, actor: string, activeMemberCount: number): Promise<ResolveResult> {
  const vote = await getVote(orgId, voteId);
  if (!vote) throw new Error(`vote ${voteId} not found`);
  if (vote.status !== "open") throw new Error(`vote is already ${vote.status}`);

  const totalCast = Object.values(vote.tally).reduce((a, b) => a + b, 0);
  const yeaCount = vote.tally["yes"] ?? vote.tally["yea"] ?? 0;

  let outcome: "passed" | "failed";
  if (vote.method === "consensus") {
    // Consensus: zero "no" votes required
    const nayCount = vote.tally["no"] ?? vote.tally["nay"] ?? 0;
    outcome = nayCount === 0 && totalCast > 0 ? "passed" : "failed";
  } else if (vote.method === "supermajority") {
    const threshold = vote.supermajority_threshold ?? 0.67;
    outcome = totalCast > 0 && yeaCount / totalCast >= threshold ? "passed" : "failed";
  } else {
    // simple_majority / ranked_choice default
    outcome = totalCast > 0 && yeaCount > totalCast / 2 ? "passed" : "failed";
  }

  const quorumFraction = vote.quorum_threshold ?? 0.5;
  const quorumMet = totalCast >= Math.ceil(activeMemberCount * quorumFraction);
  if (!quorumMet) outcome = "failed";

  vote.status = outcome;
  vote.resolved_at = new Date().toISOString();

  if (isDatabaseEnabled()) {
    await query(
      "UPDATE votes SET status = $3, resolved_at = $4 WHERE org_id = $1 AND vote_id = $2",
      [orgId, voteId, vote.status, vote.resolved_at]
    );
  } else {
    const votes = loadVotesFile(orgId);
    const idx = votes.findIndex((v) => v.vote_id === voteId);
    votes[idx] = vote;
    saveVotesFile(orgId, votes);
  }

  await appendEvent({
    event_id: randomUUID(),
    org_id: orgId,
    event_type: "vote_resolved",
    actor,
    artifact_type: null,
    artifact_id: null,
    details: { vote_id: voteId, outcome, tally: vote.tally, total_cast: totalCast, quorum_met: quorumMet },
    at: vote.resolved_at
  });

  return { vote, outcome };
}

// ── Amendment API ──────────────────────────────────────────────────────────

function loadAmendmentsFile(orgId: string): AmendmentRecord[] {
  return readJson<AmendmentRecord[]>(amendmentsKey(orgId), []);
}
function saveAmendmentsFile(orgId: string, a: AmendmentRecord[]): void {
  writeJsonAtomic(amendmentsKey(orgId), a);
}

export async function proposeAmendment(opts: {
  orgId: string;
  artifactType: string;
  proposedBy: string;
  proposedPayload: Record<string, unknown>;
  noticePeriodHours: number;
}): Promise<AmendmentRecord> {
  const now = new Date().toISOString();
  const noticeUntil = new Date(Date.now() + opts.noticePeriodHours * 3600 * 1000).toISOString();
  const amendment: AmendmentRecord = {
    amendment_id: randomUUID(),
    org_id: opts.orgId,
    artifact_type: opts.artifactType,
    proposed_by: opts.proposedBy,
    proposed_payload: opts.proposedPayload,
    status: "proposed",
    notice_until: opts.noticePeriodHours > 0 ? noticeUntil : null,
    vote_id: null,
    created_at: now,
    applied_at: null
  };

  // Governance first: record the event before the amendment is durable.
  await appendEvent({
    event_id: randomUUID(),
    org_id: opts.orgId,
    event_type: "amendment_proposed",
    actor: opts.proposedBy,
    artifact_type: null,
    artifact_id: null,
    details: { amendment_id: amendment.amendment_id, artifact_type: opts.artifactType },
    at: now
  });

  if (isDatabaseEnabled()) {
    await ensureOrg(opts.orgId);
    await ensureMember(opts.orgId, opts.proposedBy);
    await query(
      `INSERT INTO amendments
         (amendment_id, org_id, artifact_type, proposed_by, proposed_payload,
          status, notice_until, vote_id, created_at, applied_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        amendment.amendment_id,
        amendment.org_id,
        amendment.artifact_type,
        amendment.proposed_by || null,
        JSON.stringify(amendment.proposed_payload),
        amendment.status,
        amendment.notice_until,
        amendment.vote_id,
        amendment.created_at,
        amendment.applied_at,
      ]
    );
  } else {
    const all = loadAmendmentsFile(opts.orgId);
    all.push(amendment);
    saveAmendmentsFile(opts.orgId, all);
  }
  return amendment;
}

export async function getAmendment(orgId: string, amendmentId: string): Promise<AmendmentRecord | null> {
  if (isDatabaseEnabled()) {
    const { rows } = await query(
      `SELECT amendment_id, org_id, artifact_type, proposed_by, proposed_payload,
              status, notice_until, vote_id, created_at, applied_at
       FROM amendments WHERE org_id = $1 AND amendment_id = $2`,
      [orgId, amendmentId]
    );
    if (rows.length === 0) return null;
    return amendmentRowToRecord(rows[0]);
  }
  return loadAmendmentsFile(orgId).find((a) => a.amendment_id === amendmentId) ?? null;
}

export async function listAmendments(orgId: string, status?: AmendmentRecord["status"]): Promise<AmendmentRecord[]> {
  if (isDatabaseEnabled()) {
    if (status) {
      const { rows } = await query(
        `SELECT amendment_id, org_id, artifact_type, proposed_by, proposed_payload,
                status, notice_until, vote_id, created_at, applied_at
         FROM amendments WHERE org_id = $1 AND status = $2 ORDER BY created_at`,
        [orgId, status]
      );
      return rows.map(amendmentRowToRecord);
    }
    const { rows } = await query(
      `SELECT amendment_id, org_id, artifact_type, proposed_by, proposed_payload,
              status, notice_until, vote_id, created_at, applied_at
       FROM amendments WHERE org_id = $1 ORDER BY created_at`,
      [orgId]
    );
    return rows.map(amendmentRowToRecord);
  }
  const all = loadAmendmentsFile(orgId);
  return status ? all.filter((a) => a.status === status) : all;
}

/**
 * Advance an amendment through its workflow.
 * proposed → noticed (if notice_period > 0)
 * noticed/proposed → voting (creates a vote)
 * voting is resolved separately via resolveVote; caller then calls applyAmendment.
 */
export async function advanceAmendment(opts: {
  orgId: string;
  amendmentId: string;
  actor: string;
  voteDurationHours?: number;
  voteMethod?: VoteRecord["method"];
  supermajorityThreshold?: number;
  quorumThreshold?: number;
}): Promise<AmendmentRecord> {
  const amendment = await getAmendment(opts.orgId, opts.amendmentId);
  if (!amendment) throw new Error(`amendment ${opts.amendmentId} not found`);

  if (amendment.status === "proposed") {
    if (amendment.notice_until && new Date(amendment.notice_until) > new Date()) {
      // Move to noticed state, notice period not yet expired
      amendment.status = "noticed";
    } else {
      // No notice required or notice period passed — open vote
      const vote = await openVote({
        orgId: opts.orgId,
        decisionId: amendment.amendment_id,
        decisionType: `amendment:${amendment.artifact_type}`,
        method: opts.voteMethod ?? "supermajority",
        durationHours: opts.voteDurationHours ?? 48,
        actor: opts.actor,
        quorumThreshold: opts.quorumThreshold,
        supermajorityThreshold: opts.supermajorityThreshold
      });
      amendment.status = "voting";
      amendment.vote_id = vote.vote_id;
    }
  } else if (amendment.status === "noticed") {
    if (new Date(amendment.notice_until ?? "1970-01-01") > new Date()) {
      throw new Error("notice period has not expired yet");
    }
    const vote = await openVote({
      orgId: opts.orgId,
      decisionId: amendment.amendment_id,
      decisionType: `amendment:${amendment.artifact_type}`,
      method: opts.voteMethod ?? "supermajority",
      durationHours: opts.voteDurationHours ?? 48,
      actor: opts.actor,
      quorumThreshold: opts.quorumThreshold,
      supermajorityThreshold: opts.supermajorityThreshold
    });
    amendment.status = "voting";
    amendment.vote_id = vote.vote_id;
  } else {
    throw new Error(`cannot advance amendment in status '${amendment.status}'`);
  }

  if (isDatabaseEnabled()) {
    await query(
      "UPDATE amendments SET status = $3, vote_id = $4 WHERE org_id = $1 AND amendment_id = $2",
      [opts.orgId, opts.amendmentId, amendment.status, amendment.vote_id]
    );
  } else {
    const all = loadAmendmentsFile(opts.orgId);
    const idx = all.findIndex((a) => a.amendment_id === opts.amendmentId);
    all[idx] = amendment;
    saveAmendmentsFile(opts.orgId, all);
  }
  return amendment;
}

export async function applyAmendment(orgId: string, amendmentId: string, actor: string): Promise<AmendmentRecord> {
  const amendment = await getAmendment(orgId, amendmentId);
  if (!amendment) throw new Error(`amendment ${amendmentId} not found`);
  if (amendment.status !== "voting") throw new Error(`amendment is not in voting status (got: ${amendment.status})`);
  if (!amendment.vote_id) throw new Error("amendment has no associated vote");

  const vote = await getVote(orgId, amendment.vote_id);
  if (!vote || vote.status === "open") throw new Error("vote has not been resolved yet");

  amendment.status = vote.status === "passed" ? "applied" : "rejected";
  amendment.applied_at = vote.status === "passed" ? new Date().toISOString() : null;

  if (isDatabaseEnabled()) {
    await query(
      "UPDATE amendments SET status = $3, applied_at = $4 WHERE org_id = $1 AND amendment_id = $2",
      [orgId, amendmentId, amendment.status, amendment.applied_at]
    );
  } else {
    const all = loadAmendmentsFile(orgId);
    const idx = all.findIndex((a) => a.amendment_id === amendmentId);
    all[idx] = amendment;
    saveAmendmentsFile(orgId, all);
  }

  if (amendment.status === "applied") {
    await appendEvent({
      event_id: randomUUID(),
      org_id: orgId,
      event_type: "amendment_applied",
      actor,
      artifact_type: null,
      artifact_id: null,
      details: { amendment_id: amendmentId, artifact_type: amendment.artifact_type, vote_id: amendment.vote_id },
      at: new Date().toISOString()
    });
  }

  return amendment;
}

// ── Contribution tracking ──────────────────────────────────────────────────

export async function recordContribution(opts: {
  orgId: string;
  memberId: string;
  actionType: string;
  weight?: number;
}): Promise<ContributionRecord> {
  const contribution: ContributionRecord = {
    contribution_id: randomUUID(),
    org_id: opts.orgId,
    member_id: opts.memberId,
    action_type: opts.actionType,
    weight: opts.weight ?? 1,
    recorded_at: new Date().toISOString()
  };
  if (isDatabaseEnabled()) {
    await ensureMember(opts.orgId, opts.memberId);
    await query(
      `INSERT INTO contributions (contribution_id, org_id, member_id, action_type, weight, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        contribution.contribution_id,
        contribution.org_id,
        contribution.member_id,
        contribution.action_type,
        contribution.weight,
        contribution.recorded_at,
      ]
    );
  } else {
    const all = readJson<ContributionRecord[]>(contributionsKey(opts.orgId), []);
    all.push(contribution);
    writeJsonAtomic(contributionsKey(opts.orgId), all);
  }
  return contribution;
}

export async function getContributions(orgId: string, memberId?: string): Promise<ContributionRecord[]> {
  if (isDatabaseEnabled()) {
    if (memberId) {
      const { rows } = await query(
        `SELECT contribution_id, org_id, member_id, action_type, weight, recorded_at
         FROM contributions WHERE org_id = $1 AND member_id = $2 ORDER BY recorded_at`,
        [orgId, memberId]
      );
      return rows.map(contributionRowToRecord);
    }
    const { rows } = await query(
      `SELECT contribution_id, org_id, member_id, action_type, weight, recorded_at
       FROM contributions WHERE org_id = $1 ORDER BY recorded_at`,
      [orgId]
    );
    return rows.map(contributionRowToRecord);
  }
  const all = readJson<ContributionRecord[]>(contributionsKey(orgId), []);
  return memberId ? all.filter((c) => c.member_id === memberId) : all;
}

export async function getVoteBallots(orgId: string, voteId: string): Promise<BallotRecord[]> {
  if (isDatabaseEnabled()) {
    const { rows } = await query(
      `SELECT ballot_id, vote_id, member_id, choice, cast_at
       FROM vote_ballots WHERE vote_id = $1 ORDER BY cast_at`,
      [voteId]
    );
    return rows.map(ballotRowToRecord);
  }
  return loadBallotsFile(orgId).filter((b) => b.vote_id === voteId);
}
