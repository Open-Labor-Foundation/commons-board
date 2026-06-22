/**
 * Verification policy — classifies proposed actions and routes them
 * to autonomous execution, operator approval, or collective vote.
 *
 * Risk classification (0-100):
 *   0–49  → autonomous (no human sign-off required)
 *   50–84 → single operator approval
 *   85+   → dual approval (two approvers required)
 *
 * Governance mode routing:
 *   business   → operator approval queue
 *   collective → member vote for decisions_requiring_vote; approval otherwise
 *
 * The risk_escalation_threshold in autonomy_policy overrides the default (50).
 * blast_radius_escalation_threshold maps "high" blast to escalated score floor.
 */
import type { Action } from "@commons-board/shared";

export type ApprovalRoute = "autonomous" | "approval" | "vote";

export interface ApprovalRequirement {
  route: ApprovalRoute;
  required_approvers: number;
  vote_method: string | null;
  consensus_required: boolean;
  risk_score: number;
}

/** Blast radius → minimum risk score floor (overrides the action's own score). */
const BLAST_RADIUS_FLOOR: Record<string, number> = {
  high: 85,
  medium: 60,
  low: 0
};

/**
 * Classify an action and determine approval requirements.
 *
 * @param action          - The proposed action (must have risk_score + blast_radius).
 * @param governanceMode  - org governance mode from business_profile or autonomy_policy.
 * @param riskThreshold   - From autonomy_policy.risk_escalation_threshold (default 50).
 * @param blastThreshold  - From autonomy_policy.blast_radius_escalation_threshold.
 * @param decisionType    - The semantic category of the decision (for collective routing).
 * @param decisionsRequiringVote    - From collective_config.voting.decisions_requiring_vote.
 * @param decisionsRequiringConsensus - From collective_config.voting.decisions_requiring_consensus.
 * @param defaultVoteMethod - From collective_config.voting.vote_method.
 */
export function classifyAction(
  action: Action,
  governanceMode: "business" | "collective",
  riskThreshold: number = 50,
  blastThreshold: "low" | "medium" | "high" = "high",
  decisionType: string = "",
  decisionsRequiringVote: string[] = [],
  decisionsRequiringConsensus: string[] = [],
  defaultVoteMethod: string = "simple_majority"
): ApprovalRequirement {
  // Effective risk score: apply blast-radius floor
  const blastFloor = BLAST_RADIUS_FLOOR[action.blast_radius] ?? 0;
  const thresholdFloor = BLAST_RADIUS_FLOOR[blastThreshold] ?? 0;
  const effectiveScore = Math.max(action.risk_score, blastFloor >= thresholdFloor ? blastFloor : 0);

  // Autonomous if below threshold
  if (effectiveScore < riskThreshold) {
    return { route: "autonomous", required_approvers: 0, vote_method: null, consensus_required: false, risk_score: effectiveScore };
  }

  // Dual approval above 85
  const requiredApprovers = effectiveScore >= 85 ? 2 : 1;

  // Collective mode: route to vote if the decision type is listed
  if (governanceMode === "collective") {
    const needsVote = decisionsRequiringVote.includes(decisionType) || decisionsRequiringVote.includes(action.action_type);
    const needsConsensus = decisionsRequiringConsensus.includes(decisionType) || decisionsRequiringConsensus.includes(action.action_type);
    if (needsVote || needsConsensus) {
      return {
        route: "vote",
        required_approvers: 0,
        vote_method: needsConsensus ? "consensus" : defaultVoteMethod,
        consensus_required: needsConsensus,
        risk_score: effectiveScore
      };
    }
  }

  return {
    route: "approval",
    required_approvers: requiredApprovers,
    vote_method: null,
    consensus_required: false,
    risk_score: effectiveScore
  };
}

/** Derive a governor decision from a classified requirement. */
export function governorDecision(req: ApprovalRequirement): "auto_approved" | "requires_approval" | "blocked" {
  if (req.route === "autonomous") return "auto_approved";
  return "requires_approval";
}

import { randomUUID } from "node:crypto";

/** Construct an Action from the fields an agent submits. */
export function buildAction(fields: {
  org_id: string;
  agent_id: string;
  action_type: string;
  summary: string;
  evidence?: string[];
  assumptions?: string[];
  risk_score: number;
  impact_range?: string;
  blast_radius?: "low" | "medium" | "high";
  rollback_plan?: string;
  approvals_required?: number;
  governor_decision?: "auto_approved" | "requires_approval" | "blocked";
}): Action {
  return {
    action_id: randomUUID(),
    org_id: fields.org_id,
    agent_id: fields.agent_id,
    action_type: fields.action_type,
    summary: fields.summary,
    evidence: fields.evidence ?? [],
    assumptions: fields.assumptions ?? [],
    risk_score: fields.risk_score,
    impact_range: fields.impact_range ?? "unknown",
    blast_radius: fields.blast_radius ?? "low",
    approvals_required: fields.approvals_required ?? 0,
    rollback_plan: fields.rollback_plan ?? "",
    governor_decision: fields.governor_decision ?? "requires_approval",
    created_at: new Date().toISOString()
  };
}
