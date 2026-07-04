/**
 * Governance substrate types: the immutable record that sits under every action.
 *
 * Core invariant: every action is written to the decision log — signed and
 * hash-chained — BEFORE it executes, never after.
 */

import type { ArtifactType } from "./artifacts.js";

/** A signed payload (HMAC-SHA256). Mirrors lib/governance-signing.ts. */
export interface SignedPayload<T> {
  key_id: string;
  algorithm: "HMAC-SHA256";
  payload: T;
  signature: string;
}

/** The governor's decision on a proposed action. */
export type GovernorDecision = "auto_approved" | "requires_approval" | "blocked";

/**
 * An Action object — the unit of work an agent proposes. Carries the evidence a
 * human (or the collective) needs to approve it, and the rollback plan if it
 * goes wrong.
 */
export interface Action {
  action_id: string;
  org_id: string;
  agent_id: string;
  action_type: string;
  summary: string;
  evidence: string[];
  assumptions: string[];
  risk_score: number; // 0-100
  impact_range: string;
  blast_radius: "low" | "medium" | "high";
  approvals_required: number;
  rollback_plan: string;
  governor_decision: GovernorDecision;
  created_at: string;
}

/** Kinds of governance events appended to the immutable record. */
export type GovernanceEventType =
  | "artifact_written"
  | "org_activated"
  | "autonomy_mode_changed"
  | "action_proposed"
  | "action_executed"
  | "approval_recorded"
  | "vote_opened"
  | "vote_resolved"
  | "amendment_proposed"
  | "amendment_applied"
  | "distribution_executed"
  | "federation_linked"
  | "policy_floor_changed"
  | "board_request_submitted"
  | "board_request_updated"
  | "board_request_status_changed"
  | "board_roadmap_created"
  | "board_chat_completed"
  | "launch_session_started"
  | "launch_artifacts_written"
  | "meeting_created"
  | "meeting_closed"
  | "meeting_respond_completed"
  | "exec_session_created";

/** A governance event. Signed and chained when persisted. */
export interface GovernanceEvent {
  event_id: string;
  org_id: string;
  event_type: GovernanceEventType;
  actor: string;
  artifact_type: ArtifactType | null;
  artifact_id: string | null;
  details: Record<string, unknown>;
  at: string;
}

/** An append-only decision log entry, hash-chained to its predecessor. */
export interface DecisionLogEntry {
  entry_id: string;
  org_id: string;
  sequence: number;
  event: GovernanceEvent;
  signed: SignedPayload<GovernanceEvent>;
  previous_hash: string;
  entry_hash: string;
  at: string;
}

export type ApprovalStatus = "pending" | "approved" | "rejected";

/** A human (or collective) approval record for an action requiring sign-off. */
export interface ApprovalRecord {
  approval_id: string;
  org_id: string;
  action_id: string;
  action_type?: string;
  summary?: string;
  risk_score?: number;
  blast_radius?: "low" | "medium" | "high";
  status: ApprovalStatus;
  required_approvers: number;
  responses: Array<{
    approver_id: string;
    decision: "approve" | "reject";
    note: string;
    at: string;
  }>;
  created_at: string;
  resolved_at: string | null;
}
