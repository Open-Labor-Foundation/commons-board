/**
 * Chat interpreter — maps an incoming message to a BoardInterpretationSpec.
 *
 * Ported from mother-board services/chat-interpreter.ts.
 * Sanitized:
 *   - Removed org-specific workflow branch detection (grant-pipeline, loan-packet)
 *   - Removed Missouri/Louisiana jurisdiction detection
 *   - Removed "Mother-Board" string literals and AEB references
 *   - Clean generic commons-board logic only
 */
import type { BoardDomain, BoardInterpretationSpec } from "@commons-board/shared";
import type { BoardSessionState } from "@commons-board/shared";
import { buildInterpretationSpec } from "./model-native-router.js";

export type ChatInterpretationInput = {
  message: string;
  workspaceId: string;
  threadId: string;
  sessionState: BoardSessionState;
  chairAlias?: string;
  forceChairDomain?: BoardDomain;
  forceChairId?: string;
};

export type ChatInterpretationResult = {
  spec: BoardInterpretationSpec;
  routing_note: string;
  reused_context: boolean;
};

function reuseContextIfMinor(
  message: string,
  session: BoardSessionState
): { reuse: boolean; reuse_reason?: string } {
  const lower = message.toLowerCase().trim();
  const FOLLOW_UP_PATTERNS = [
    "and also", "what about", "how about", "can you also",
    "expand on", "tell me more", "go deeper", "more detail",
    "summarize that", "add to that", "based on that", "following up"
  ];
  if (!session.active_chair_domain && !session.active_operation_kind) {
    return { reuse: false };
  }
  if (FOLLOW_UP_PATTERNS.some((p) => lower.startsWith(p) || lower.includes(p))) {
    return { reuse: true, reuse_reason: "follow-up pattern matched" };
  }
  if (lower.length < 40 && session.active_chair_domain) {
    return { reuse: true, reuse_reason: "short message with active chair context" };
  }
  return { reuse: false };
}

export function interpretChatMessage(input: ChatInterpretationInput): ChatInterpretationResult {
  const { message, sessionState } = input;

  const contextCheck = reuseContextIfMinor(message, sessionState);

  if (contextCheck.reuse && sessionState.last_interpretation) {
    return {
      spec: {
        ...(sessionState.last_interpretation as BoardInterpretationSpec),
        task_spec: {
          ...(sessionState.last_interpretation.task_spec ?? {}),
          message,
          context_reused: true
        }
      },
      routing_note: contextCheck.reuse_reason ?? "context reused",
      reused_context: true
    };
  }

  const spec = buildInterpretationSpec(message, {
    chairAlias: input.chairAlias,
    existingChairId: input.forceChairId ?? sessionState.active_chair_id,
    existingChairDomain: input.forceChairDomain ?? sessionState.active_chair_domain,
    committeeIds: sessionState.active_committee_ids,
    committeeDomains: sessionState.active_committee_domains
  });

  const routing_note = spec.target_chair_domain
    ? `routed to ${spec.target_chair_domain.toUpperCase()} (${spec.operation_kind})`
    : spec.conversation_mode === "committee"
      ? `committee mode (${spec.committee_domains.join(", ")})`
      : `board mode (${spec.operation_kind})`;

  return { spec, routing_note, reused_context: false };
}
