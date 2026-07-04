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
 * All state is file-backed (persistence.ts); PostgreSQL migration 0002_collective.sql
 * defines the production schema. The same logical operations run in both.
 */
import { randomUUID } from "node:crypto";
import { appendEvent } from "./decision-log.js";
import { readJson, writeJsonAtomic } from "./persistence.js";

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

function loadVotes(orgId: string): VoteRecord[] {
  return readJson<VoteRecord[]>(votesKey(orgId), []);
}
function saveVotes(orgId: string, v: VoteRecord[]): void {
  writeJsonAtomic(votesKey(orgId), v);
}
function loadBallots(orgId: string): BallotRecord[] {
  return readJson<BallotRecord[]>(ballotsKey(orgId), []);
}
function saveBallots(orgId: string, b: BallotRecord[]): void {
  writeJsonAtomic(ballotsKey(orgId), b);
}

// ── Vote API ───────────────────────────────────────────────────────────────

export function openVote(opts: {
  orgId: string;
  decisionId: string;
  decisionType: string;
  method: VoteRecord["method"];
  durationHours: number;
  actor: string;
  quorumThreshold?: number;
  supermajorityThreshold?: number;
}): VoteRecord {
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

  appendEvent({
    event_id: randomUUID(),
    org_id: opts.orgId,
    event_type: "vote_opened",
    actor: opts.actor,
    artifact_type: null,
    artifact_id: null,
    details: { vote_id: vote.vote_id, decision_id: opts.decisionId, decision_type: opts.decisionType, method: opts.method },
    at: vote.opened_at
  });

  const votes = loadVotes(opts.orgId);
  votes.push(vote);
  saveVotes(opts.orgId, votes);
  return vote;
}

export function getVote(orgId: string, voteId: string): VoteRecord | null {
  return loadVotes(orgId).find((v) => v.vote_id === voteId) ?? null;
}

export function listVotes(orgId: string, status?: VoteRecord["status"]): VoteRecord[] {
  const all = loadVotes(orgId);
  return status ? all.filter((v) => v.status === status) : all;
}

export interface CastResult {
  ballot: BallotRecord;
  vote: VoteRecord;
  quorum_reached: boolean;
}

export function castBallot(opts: {
  orgId: string;
  voteId: string;
  memberId: string;
  choice: string;
  activeMemberCount: number;
}): CastResult {
  const votes = loadVotes(opts.orgId);
  const vote = votes.find((v) => v.vote_id === opts.voteId);
  if (!vote) throw new Error(`vote ${opts.voteId} not found`);
  if (vote.status !== "open") throw new Error(`vote is ${vote.status}, not open`);
  if (new Date(vote.closes_at) < new Date()) throw new Error("vote has expired");

  const ballots = loadBallots(opts.orgId);
  const existing = ballots.find((b) => b.vote_id === opts.voteId && b.member_id === opts.memberId);
  if (existing) throw new Error(`member ${opts.memberId} has already cast a ballot on vote ${opts.voteId}`);

  const ballot: BallotRecord = {
    ballot_id: randomUUID(),
    vote_id: opts.voteId,
    member_id: opts.memberId,
    choice: opts.choice,
    cast_at: new Date().toISOString()
  };
  ballots.push(ballot);
  saveBallots(opts.orgId, ballots);

  // Update tally
  vote.tally[opts.choice] = (vote.tally[opts.choice] ?? 0) + 1;
  const totalCast = Object.values(vote.tally).reduce((a, b) => a + b, 0);
  const quorumFraction = vote.quorum_threshold ?? 0.5;
  const quorumReached = totalCast >= Math.ceil(opts.activeMemberCount * quorumFraction);

  const voteIdx = votes.findIndex((v) => v.vote_id === opts.voteId);
  votes[voteIdx] = vote;
  saveVotes(opts.orgId, votes);

  return { ballot, vote, quorum_reached: quorumReached };
}

export interface ResolveResult {
  vote: VoteRecord;
  outcome: "passed" | "failed";
}

export function resolveVote(orgId: string, voteId: string, actor: string, activeMemberCount: number): ResolveResult {
  const votes = loadVotes(orgId);
  const idx = votes.findIndex((v) => v.vote_id === voteId);
  if (idx < 0) throw new Error(`vote ${voteId} not found`);
  const vote = { ...votes[idx] };
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
  votes[idx] = vote;
  saveVotes(orgId, votes);

  appendEvent({
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

function loadAmendments(orgId: string): AmendmentRecord[] {
  return readJson<AmendmentRecord[]>(amendmentsKey(orgId), []);
}
function saveAmendments(orgId: string, a: AmendmentRecord[]): void {
  writeJsonAtomic(amendmentsKey(orgId), a);
}

export function proposeAmendment(opts: {
  orgId: string;
  artifactType: string;
  proposedBy: string;
  proposedPayload: Record<string, unknown>;
  noticePeriodHours: number;
}): AmendmentRecord {
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

  appendEvent({
    event_id: randomUUID(),
    org_id: opts.orgId,
    event_type: "amendment_proposed",
    actor: opts.proposedBy,
    artifact_type: null,
    artifact_id: null,
    details: { amendment_id: amendment.amendment_id, artifact_type: opts.artifactType },
    at: now
  });

  const all = loadAmendments(opts.orgId);
  all.push(amendment);
  saveAmendments(opts.orgId, all);
  return amendment;
}

export function getAmendment(orgId: string, amendmentId: string): AmendmentRecord | null {
  return loadAmendments(orgId).find((a) => a.amendment_id === amendmentId) ?? null;
}

export function listAmendments(orgId: string, status?: AmendmentRecord["status"]): AmendmentRecord[] {
  const all = loadAmendments(orgId);
  return status ? all.filter((a) => a.status === status) : all;
}

/**
 * Advance an amendment through its workflow.
 * proposed → noticed (if notice_period > 0)
 * noticed/proposed → voting (creates a vote)
 * voting is resolved separately via resolveVote; caller then calls applyAmendment.
 */
export function advanceAmendment(opts: {
  orgId: string;
  amendmentId: string;
  actor: string;
  voteDurationHours?: number;
  voteMethod?: VoteRecord["method"];
  supermajorityThreshold?: number;
  quorumThreshold?: number;
}): AmendmentRecord {
  const all = loadAmendments(opts.orgId);
  const idx = all.findIndex((a) => a.amendment_id === opts.amendmentId);
  if (idx < 0) throw new Error(`amendment ${opts.amendmentId} not found`);
  const amendment = { ...all[idx] };

  if (amendment.status === "proposed") {
    if (amendment.notice_until && new Date(amendment.notice_until) > new Date()) {
      // Move to noticed state, notice period not yet expired
      amendment.status = "noticed";
    } else {
      // No notice required or notice period passed — open vote
      const vote = openVote({
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
    const vote = openVote({
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

  all[idx] = amendment;
  saveAmendments(opts.orgId, all);
  return amendment;
}

export function applyAmendment(orgId: string, amendmentId: string, actor: string): AmendmentRecord {
  const all = loadAmendments(orgId);
  const idx = all.findIndex((a) => a.amendment_id === amendmentId);
  if (idx < 0) throw new Error(`amendment ${amendmentId} not found`);
  const amendment = { ...all[idx] };
  if (amendment.status !== "voting") throw new Error(`amendment is not in voting status (got: ${amendment.status})`);
  if (!amendment.vote_id) throw new Error("amendment has no associated vote");

  const vote = getVote(orgId, amendment.vote_id);
  if (!vote || vote.status === "open") throw new Error("vote has not been resolved yet");

  amendment.status = vote.status === "passed" ? "applied" : "rejected";
  amendment.applied_at = vote.status === "passed" ? new Date().toISOString() : null;
  all[idx] = amendment;
  saveAmendments(orgId, all);

  if (amendment.status === "applied") {
    appendEvent({
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

export function recordContribution(opts: {
  orgId: string;
  memberId: string;
  actionType: string;
  weight?: number;
}): ContributionRecord {
  const contribution: ContributionRecord = {
    contribution_id: randomUUID(),
    org_id: opts.orgId,
    member_id: opts.memberId,
    action_type: opts.actionType,
    weight: opts.weight ?? 1,
    recorded_at: new Date().toISOString()
  };
  const all = readJson<ContributionRecord[]>(contributionsKey(opts.orgId), []);
  all.push(contribution);
  writeJsonAtomic(contributionsKey(opts.orgId), all);
  return contribution;
}

export function getContributions(orgId: string, memberId?: string): ContributionRecord[] {
  const all = readJson<ContributionRecord[]>(contributionsKey(orgId), []);
  return memberId ? all.filter((c) => c.member_id === memberId) : all;
}

export function getVoteBallots(orgId: string, voteId: string): BallotRecord[] {
  return loadBallots(orgId).filter((b) => b.vote_id === voteId);
}
