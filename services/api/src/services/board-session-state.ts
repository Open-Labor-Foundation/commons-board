/**
 * Board session state — per-thread context for board/chair conversations.
 *
 * Ported from mother-board services/board-session-state.ts.
 * Sanitized: no org-specific workflow keys or grant/loan pipeline state.
 */
import { readJson, writeJsonAtomic } from "../lib/persistence.js";
import type { BoardSessionState, BoardInterpretationSpec } from "@commons-board/shared";

function sessionKey(workspaceId: string, threadId: string): string {
  return `sessions/${workspaceId}/${threadId}`;
}

function emptySession(): BoardSessionState {
  return {
    active_context: { committee_ids: [], committee_domains: [], actions: [], approvals: [] },
    strategic_context: { committee_ids: [], committee_domains: [], actions: [], approvals: [] },
    active_committee_ids: [],
    active_committee_domains: [],
    active_action_ids: [],
    active_approval_ids: []
  };
}

export function getSessionState(workspaceId: string, threadId: string): BoardSessionState {
  return readJson<BoardSessionState>(sessionKey(workspaceId, threadId), emptySession());
}

export function updateSessionState(
  workspaceId: string,
  threadId: string,
  patch: Partial<BoardSessionState>
): BoardSessionState {
  const current = getSessionState(workspaceId, threadId);
  const next: BoardSessionState = { ...current, ...patch };
  writeJsonAtomic(sessionKey(workspaceId, threadId), next);
  return next;
}

export function applyInterpretation(
  workspaceId: string,
  threadId: string,
  spec: BoardInterpretationSpec
): BoardSessionState {
  const current = getSessionState(workspaceId, threadId);
  return updateSessionState(workspaceId, threadId, {
    active_workflow_key: spec.workflow_key ?? current.active_workflow_key,
    active_operation_kind: spec.operation_kind,
    active_deliverable_kind: spec.deliverable_kind ?? current.active_deliverable_kind,
    active_chair_id: spec.target_chair_id ?? current.active_chair_id,
    active_chair_domain: spec.target_chair_domain ?? current.active_chair_domain,
    active_committee_ids: spec.committee_ids.length > 0 ? spec.committee_ids : current.active_committee_ids,
    active_committee_domains: spec.committee_domains.length > 0 ? spec.committee_domains : current.active_committee_domains,
    last_response_mode: spec.response_mode,
    last_interpretation: spec
  });
}

export function clearSessionState(workspaceId: string, threadId: string): void {
  writeJsonAtomic(sessionKey(workspaceId, threadId), emptySession());
}
