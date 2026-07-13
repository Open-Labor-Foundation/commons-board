/**
 * Board orchestration types: domains, requests, roadmaps, and session state.
 *
 * BoardDomain is the canonical set of chair types in commons-board.
 * Mother-board's "cio" domain is not carried — IT strategy maps to "it" or "strategy".
 */

export type BoardDomain =
  | "finance"
  | "ops"
  | "growth"
  | "legal"
  | "hr"
  | "product"
  | "it"
  | "security"
  | "strategy"
  | "rnd"
  | "sales";

export type BoardRequestStatus =
  | "submitted"
  | "triaged"
  | "planned"
  | "approved"
  | "executing"
  | "blocked"
  | "completed"
  | "rejected";

export type BoardRequestPriority = "low" | "medium" | "high" | "critical";

export interface BoardRequestRecord {
  id: string;
  org_id: string;
  title: string;
  request: string;
  requested_by: string;
  target_chair_id: string;
  target_domain: BoardDomain;
  routing_mode: "explicit" | "auto";
  status: BoardRequestStatus;
  priority: BoardRequestPriority;
  constraints: string[];
  deadline?: string;
  success_criteria: string[];
  dependency_ids: string[];
  approval_required: boolean;
  risk_level: "low" | "medium" | "high";
  latest_roadmap_version?: number;
  created_at: string;
  updated_at: string;
  /** Set once a delegate_to_child proposal is proposed against the target chair's commons-crew run; null until a dispatch is attempted. */
  commons_crew_dispatch?: CommonsCrewDispatchState | null;
  /**
   * Explicit per-request opt-in: propose a commons-crew dispatch
   * automatically when this request's status transitions to "approved",
   * instead of requiring an admin/operator to trigger
   * POST .../dispatch-to-commons-crew manually. Defaults to false --
   * whether every approved request should go through commons-crew instead
   * of (or alongside) the existing direct-LLM chair-reasoning path is a
   * product decision this field doesn't make; it only makes the choice
   * available per request rather than changing default behavior for
   * requests that don't ask for it. Proposing is still the only automatic
   * part -- actually approving and executing the dispatch still requires
   * the separate, explicit POST .../dispatch-to-commons-crew/decision.
   */
  auto_dispatch_to_commons_crew?: boolean;
}

export type CommonsCrewDispatchState =
  | { status: "awaiting_decision"; approval_id: string; proposal_id: string; run_id: string; proposed_at: string }
  | { status: "approved"; child_run_id: string; layer: string; decided_at: string; decided_by: string }
  | { status: "denied"; decided_at: string; decided_by: string }
  | { status: "unavailable"; reason: string; attempted_at: string };

export interface BoardRoadmapPhase {
  name: string;
  duration_days: number;
  objective: string;
  milestones: string[];
  dependencies: string[];
  owners: string[];
}

export interface BoardRoadmapRecord {
  id: string;
  org_id: string;
  request_id: string;
  version: number;
  domain: BoardDomain;
  owner_chair_id: string;
  summary: string;
  assumptions: string[];
  risks: string[];
  mitigation_plan: string[];
  resource_requests: string[];
  phases: BoardRoadmapPhase[];
  created_by: string;
  created_at: string;
}

export interface BoardActiveBoardContext {
  workflow_key?: string;
  operation_kind?: string;
  deliverable_kind?: string;
  chair_id?: string;
  chair_domain?: BoardDomain;
  committee_ids: string[];
  committee_domains: BoardDomain[];
  actions: Array<{ action_id: string }>;
  approvals: Array<{ approval_id: string }>;
}

export interface BoardSessionState {
  active_context: BoardActiveBoardContext;
  strategic_context: BoardActiveBoardContext;
  active_workflow_key?: string;
  active_operation_kind?: string;
  active_deliverable_kind?: string;
  active_chair_id?: string;
  active_chair_domain?: BoardDomain;
  active_committee_ids: string[];
  active_committee_domains: BoardDomain[];
  active_action_ids: string[];
  active_approval_ids: string[];
  last_response_mode?: string;
  last_interpretation?: Partial<BoardInterpretationSpec>;
}

export type BoardConversationMode = "chair" | "board" | "committee";
export type BoardResponseMode = "prose" | "memo" | "checklist" | "json";
export type BoardTaskOperationKind =
  | "analysis"
  | "planning"
  | "execution"
  | "review"
  | "recommendation"
  | "approval_request";

export interface BoardInterpretationSpec {
  workflow_key?: string;
  conversation_mode: BoardConversationMode;
  response_mode: BoardResponseMode;
  operation_kind: BoardTaskOperationKind;
  deliverable_kind?: string;
  target_chair_id?: string;
  target_chair_domain?: BoardDomain;
  committee_ids: string[];
  committee_domains: BoardDomain[];
  task_spec: Record<string, unknown>;
}
