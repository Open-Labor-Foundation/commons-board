/**
 * Model-native domain router — derives BoardDomain and interpretation spec
 * from free-text input using lexical cue analysis (no LLM call required).
 *
 * Ported from mother-board services/model-native-router.ts (~259 LOC).
 * Sanitized:
 *   - Removed "cio" domain and associated cues (merged into "it")
 *   - Removed org-specific workflow branch detection (grant-pipeline, aieb refs)
 *   - Removed Missouri/Louisiana jurisdiction signals
 *   - Removed "Mother-Board" string literals
 */
import type { BoardDomain, BoardConversationMode, BoardResponseMode, BoardTaskOperationKind, BoardInterpretationSpec } from "@commons-board/shared";
import { domainRelevanceScores, normalizeChairAlias, KNOWN_DOMAINS } from "./model-native-semantics.js";
import { getWorkflowRoute, matchWorkflowByDomain } from "./chat-routing-registry.js";

const RESPONSE_MODE_SIGNALS: Record<string, BoardResponseMode> = {
  memo: "memo",
  brief: "memo",
  checklist: "checklist",
  "action items": "checklist",
  "bullet": "checklist",
  "json": "json",
  "machine readable": "json",
  "structured output": "json"
};

const OPERATION_KIND_SIGNALS: Array<{ patterns: string[]; kind: BoardTaskOperationKind }> = [
  { patterns: ["approve", "approval", "authorize", "sign off", "green light"], kind: "approval_request" },
  { patterns: ["review", "audit", "assess", "evaluate", "critique", "evaluate"], kind: "review" },
  { patterns: ["plan", "roadmap", "schedule", "timeline", "phase", "milestone"], kind: "planning" },
  { patterns: ["execute", "implement", "run", "deploy", "rollout", "launch"], kind: "execution" },
  { patterns: ["recommend", "suggest", "advise", "what should", "how should", "what would you"], kind: "recommendation" }
];

const CHAIR_SIGNALS: Array<{ patterns: string[]; domain: BoardDomain }> = [
  { patterns: ["finance chair", "cfo", "finance team", "financial review"], domain: "finance" },
  { patterns: ["legal chair", "counsel", "legal team", "contracts team", "attorney"], domain: "legal" },
  { patterns: ["it chair", "cio", "technology chair", "it team", "infrastructure team"], domain: "it" },
  { patterns: ["hr chair", "people chair", "chro", "hr team", "people team"], domain: "hr" },
  { patterns: ["ops chair", "coo", "operations chair", "operations team"], domain: "ops" },
  { patterns: ["security chair", "ciso", "security team"], domain: "security" },
  { patterns: ["growth chair", "growth team", "marketing chair", "growth lead"], domain: "growth" },
  { patterns: ["sales chair", "crm", "revenue chair", "sales team", "account management"], domain: "sales" },
  { patterns: ["product chair", "cpo", "product team", "product management"], domain: "product" },
  { patterns: ["strategy chair", "cso", "strategy team", "strategy lead"], domain: "strategy" },
  { patterns: ["rnd chair", "r&d chair", "research chair", "innovation chair"], domain: "rnd" }
];

const COMMITTEE_SIGNALS: string[] = [
  "full board", "entire board", "all chairs", "board committee", "committee review", "cross-domain"
];

function detectResponseMode(text: string): BoardResponseMode {
  const lower = text.toLowerCase();
  for (const [signal, mode] of Object.entries(RESPONSE_MODE_SIGNALS)) {
    if (lower.includes(signal)) return mode;
  }
  return "prose";
}

function detectOperationKind(text: string): BoardTaskOperationKind {
  const lower = text.toLowerCase();
  for (const { patterns, kind } of OPERATION_KIND_SIGNALS) {
    if (patterns.some((p) => lower.includes(p))) return kind;
  }
  return "analysis";
}

function detectConversationMode(text: string, targetDomain: BoardDomain | null): BoardConversationMode {
  const lower = text.toLowerCase();
  if (COMMITTEE_SIGNALS.some((s) => lower.includes(s))) return "committee";
  if (targetDomain !== null) return "chair";
  return "board";
}

function detectExplicitChairDomain(text: string): BoardDomain | null {
  const lower = text.toLowerCase();
  for (const { patterns, domain } of CHAIR_SIGNALS) {
    if (patterns.some((p) => lower.includes(p))) return domain;
  }
  return null;
}

export type RoutingInference = {
  primary_domain: BoardDomain;
  confidence: number;
  conversation_mode: BoardConversationMode;
  operation_kind: BoardTaskOperationKind;
  response_mode: BoardResponseMode;
  explicit_chair_domain: BoardDomain | null;
  domain_scores: Array<{ domain: BoardDomain; score: number }>;
};

export function inferRoutingFromText(text: string, chairAlias?: string): RoutingInference {
  const scores = domainRelevanceScores(text);
  const explicitFromText = detectExplicitChairDomain(text);

  let resolvedAlias: BoardDomain | null = null;
  if (chairAlias) {
    const normalized = normalizeChairAlias(chairAlias);
    if ((KNOWN_DOMAINS as string[]).includes(normalized)) resolvedAlias = normalized as BoardDomain;
  }

  const explicitDomain = resolvedAlias ?? explicitFromText;
  const primaryDomain: BoardDomain = explicitDomain ?? ((scores[0]?.score ?? 0) >= 0.15 ? scores[0].domain : "ops");
  const confidence = explicitDomain ? 0.9 : Math.min(0.85, scores[0]?.score ?? 0.2);

  return {
    primary_domain: primaryDomain,
    confidence,
    conversation_mode: detectConversationMode(text, explicitDomain),
    operation_kind: detectOperationKind(text),
    response_mode: detectResponseMode(text),
    explicit_chair_domain: explicitDomain,
    domain_scores: scores
  };
}

export function buildInterpretationSpec(
  text: string,
  options: {
    chairAlias?: string;
    existingChairId?: string;
    existingChairDomain?: BoardDomain;
    committeeIds?: string[];
    committeeDomains?: BoardDomain[];
  } = {}
): BoardInterpretationSpec {
  const inference = inferRoutingFromText(text, options.chairAlias);
  const operationKind = inference.operation_kind;
  const domain = options.existingChairDomain ?? inference.primary_domain;

  const route = matchWorkflowByDomain(domain, operationKind);
  const workflow_key = route?.key;

  const isCommittee = inference.conversation_mode === "committee";

  return {
    workflow_key,
    conversation_mode: isCommittee ? "committee" : inference.conversation_mode,
    response_mode: inference.response_mode,
    operation_kind: operationKind,
    target_chair_id: isCommittee ? undefined : (options.existingChairId ?? undefined),
    target_chair_domain: isCommittee ? undefined : domain,
    committee_ids: isCommittee ? (options.committeeIds ?? []) : [],
    committee_domains: isCommittee ? (options.committeeDomains ?? [domain]) : [],
    task_spec: {
      primary_domain: domain,
      confidence: inference.confidence,
      text_length: text.length,
      domain_scores: inference.domain_scores.slice(0, 3)
    }
  };
}

export function resolveWorkflowSpec(workflowKey: string): ReturnType<typeof getWorkflowRoute> {
  return getWorkflowRoute(workflowKey);
}
