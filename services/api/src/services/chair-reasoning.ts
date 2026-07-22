/**
 * Chair reasoning — builds a domain-specific reasoned board response.
 *
 * Ported from mother-board services/chair-reasoning.ts.
 * Sanitized:
 *   - Removed aieb/exec_agent_builder_docs corpus loading → replaced with
 *     labor-commons specialist spec loading (authority_sources, out_of_scope_rules)
 *   - Removed "cio" domain from all switch/case and keyword maps → merged into "it"
 *   - Removed compensation analysis (gated by hr_agent_enabled; always disabled here)
 *   - Removed Missouri/Louisiana jurisdiction extraction (org-specific pre-OLF content)
 *   - Citations now point to labor-commons authority sources from the chair's resolved spec
 */
import { getDomainCapabilities } from "../lib/board-orchestration.js";
import { getSpecialist } from "../lib/labor-commons-client.js";
import { NoProviderConfiguredError, parseThinking } from "../lib/model-client.js";
import { enqueueInference, type InferenceCallType } from "../lib/inference-queue.js";
import type { BoardDomain, BoardRequestRecord, BoardRoadmapRecord } from "@commons-board/shared";

type ReasoningInput = {
  workspaceId: string;
  request: BoardRequestRecord;
  roadmap: BoardRoadmapRecord;
  laborCommonsSlug?: string;
  /** Per-chair model override — passed directly to the inference call. */
  model?: string;
  /** Queue call type — defaults to "chair_deliberation". */
  callType?: InferenceCallType;
};

type ReasoningMeta = {
  engine: "chair_reasoner_v1";
  domain: BoardDomain;
  confidence: number;
  assumptions: string[];
  evidence: string[];
  citations: string[];
};

export type ChairReasoningResult = {
  responseText: string;
  thinking: string;
  responseMeta: ReasoningMeta;
};

function compact(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function extractMoneySignals(text: string): string[] {
  const matches = [...text.matchAll(/\$?\d+(?:\.\d+)?\s?(?:m|mm|million|k|thousand|b|billion)?/gi)];
  const uniq = new Set<string>();
  for (const match of matches) {
    const value = compact(match[0]);
    if (/\$|m\b|mm\b|million|k\b|thousand|b\b|billion/i.test(value)) uniq.add(value);
  }
  return [...uniq].slice(0, 6);
}

function makeDomainLens(domain: BoardDomain): string[] {
  switch (domain) {
    case "finance":
      return [
        "Compare cash-heavy, balanced, and upside-heavy structures against expected value",
        "Define payment gates and objective benefit measurement before upside triggers",
        "Model downside protection if scope, timeline, or ownership assumptions shift"
      ];
    case "legal":
      return [
        "Separate pre-existing IP from employer work product in contract language",
        "Control disclosure sequencing with NDA and scoped confidentiality boundaries",
        "Require counsel review for employment, assignment, and incentive enforceability"
      ];
    case "it":
      return [
        "Define phased transformation plan with acceptance criteria per process family",
        "Tie milestones to verified technical and operational outcomes",
        "Use governance checkpoints to stop scope drift and unmanaged dependencies"
      ];
    case "hr":
      return [
        "Plan human verification roles and staffing model for AI-first operations",
        "Set role transition plan, training obligations, and accountability boundaries",
        "Protect retention through transparent role redesign and incentive alignment"
      ];
    case "security":
      return [
        "Set minimum control baseline before production automation expansion",
        "Attach milestones to compliance and incident-readiness proof",
        "Require auditability and evidence retention for all high-impact actions"
      ];
    case "rnd":
      return [
        "Validate assumptions through staged experiments before enterprise-wide commitments",
        "Quantify expected gains and uncertainty bands per workstream",
        "Publish evidence packets for each recommendation so decisions can be verified"
      ];
    case "ops":
      return [
        "Turn strategy into an executable operating cadence with clear owners",
        "Link triggers to throughput, quality, and cycle-time outcomes",
        "Enforce escalation paths for blocked dependencies"
      ];
    case "strategy":
      return [
        "Align structure to enterprise value creation and optionality",
        "Sequence negotiation so controls are locked before technical depth disclosure",
        "Present multiple commercial options to preserve leverage while reducing friction"
      ];
    default:
      return [
        "Link commitments to measurable business outcomes",
        "Set phased commitments with hard acceptance criteria",
        "Maintain governance and risk controls throughout execution"
      ];
  }
}

function deriveConfidence(input: {
  hasMoneySignals: boolean;
  hasSuccessCriteria: boolean;
  hasConstraints: boolean;
  hasSpecCitations: boolean;
}): number {
  let score = 0.62;
  if (input.hasMoneySignals) score += 0.08;
  if (input.hasSuccessCriteria) score += 0.1;
  if (input.hasConstraints) score += 0.05;
  if (input.hasSpecCitations) score += 0.1;
  return Math.min(0.95, Number(score.toFixed(2)));
}

function summarizeScope(request: BoardRequestRecord): string {
  const criteria = request.success_criteria.length > 0
    ? request.success_criteria.map((item) => `- ${item}`).join("\n")
    : "- establish measurable success criteria";
  return [
    "Scope framing:",
    `- domain owner: ${request.target_domain.toUpperCase()} (${request.target_chair_id})`,
    `- priority: ${request.priority.toUpperCase()}`,
    `- objective: ${compact(request.title)}`,
    "Success criteria:",
    criteria
  ].join("\n");
}

export async function buildReasonedBoardResponse(input: ReasoningInput): Promise<ChairReasoningResult> {
  const requestText = `${input.request.title}\n${input.request.request}\n${input.request.constraints.join("\n")}`;
  const moneySignals = extractMoneySignals(requestText);
  const domainLens = makeDomainLens(input.request.target_domain);
  const capabilities = getDomainCapabilities().find((item) => item.domain === input.request.target_domain);

  const citations: string[] = [];
  let specialistContext: string[] = [];
  if (input.laborCommonsSlug) {
    const spec = await getSpecialist(input.laborCommonsSlug);
    if (spec) {
      citations.push(...spec.knowledge_baseline.slice(0, 4));
      specialistContext = (spec.scope.out_of_scope_rules ?? []).slice(0, 2)
        .map((rule) => `Note: ${rule}`);
    }
  }

  const confidence = deriveConfidence({
    hasMoneySignals: moneySignals.length > 0,
    hasSuccessCriteria: input.request.success_criteria.length > 0,
    hasConstraints: input.request.constraints.length > 0,
    hasSpecCitations: citations.length > 0
  });

  const assumptions = [
    "Stakeholders will accept phased sequencing",
    "Outcome metrics can be baselined before full implementation",
    "Domain authority sources are current as of last specialist review"
  ];

  const evidence = [
    moneySignals.length > 0 ? `Monetary signals detected: ${moneySignals.join(", ")}` : "No explicit monetary signals detected",
    `Roadmap phases available: ${input.roadmap.phases.length}`,
    capabilities ? `Domain outcomes: ${capabilities.primary_outcomes.join(", ")}` : `Domain: ${input.request.target_domain.toUpperCase()}`,
    citations.length > 0 ? `Specialist authority sources: ${citations.length}` : "No specialist spec loaded"
  ];

  // Try LLM — fall back to template if no provider is configured.
  let responseText: string;
  let responseThinking = "";
  const today = new Date().toISOString().split("T")[0];
  try {
    const systemPrompt = [
      `You are the ${input.request.target_domain.toUpperCase()} chair of a governing board.`,
      `You provide strategic ${input.request.target_domain} analysis and concrete recommendations.`,
      `Current date: ${today}. When referencing dates or timeframes, use this as the baseline — never reference years before it.`,
      "",
      "Reasoning principles for this domain:",
      ...domainLens.map((l) => `- ${l}`),
      ...(capabilities ? ["", `Core ${input.request.target_domain} outcomes: ${capabilities.primary_outcomes.join(", ")}.`] : []),
      ...(specialistContext.length > 0 ? ["", "Specialist scope guidance:", ...specialistContext.map((s) => `- ${s}`)] : []),
      ...(citations.length > 0 ? ["", "Authority sources:", ...citations.map((c) => `- ${c}`)] : []),
      "",
      "Be direct and specific. Respond in natural prose unless the human explicitly asked for a memo, checklist, or formal structure.",
      "Cover the key decision, risk, or opportunity — don't hedge excessively, but don't force a fixed section layout on every response.",
      "Vary your structure based on what the situation actually calls for."
    ].join("\n");

    const userParts = [input.request.request];
    if (input.request.constraints.length > 0) {
      userParts.push("", "Constraints:", ...input.request.constraints.map((c) => `- ${c}`));
    }
    if (input.request.success_criteria.length > 0) {
      userParts.push("", "Success criteria:", ...input.request.success_criteria.map((s) => `- ${s}`));
    }
    if (moneySignals.length > 0) {
      userParts.push("", `Financial signals in context: ${moneySignals.join(", ")}`);
    }

    const result = await enqueueInference({
      callType: input.callType ?? "chair_deliberation",
      workspaceId: input.workspaceId,
      prompt: userParts.join("\n"),
      systemPrompt: systemPrompt,
      model: input.model,
      temperature: 0.7,
      metadata: { chairId: input.request.target_chair_id, requestId: input.request.id },
    });
    const parsed = parseThinking(result.text);
    responseText = parsed.answer;
    responseThinking = parsed.thinking;
  } catch (err) {
    if (err instanceof NoProviderConfiguredError) {
      // Template fallback — provider not configured yet.
      const domain = input.request.target_domain.toUpperCase();
      const title = compact(input.request.title);
      responseText =
        `${domain} take on "${title}": ${domainLens[0] ?? "No specific lens available."} ` +
        `The gating concern here is ${domainLens[1] ?? "ensuring scope is locked before execution"}. ` +
        (specialistContext.length > 0 ? `${specialistContext.join(" ")} ` : "") +
        `_No inference provider configured — configure one in Settings to enable full AI responses._`;
    } else {
      throw err;
    }
  }

  return {
    responseText,
    thinking: responseThinking,
    responseMeta: {
      engine: "chair_reasoner_v1",
      domain: input.request.target_domain,
      confidence,
      assumptions,
      evidence,
      citations: citations.length > 0 ? citations : ["labor-commons catalog (no specialist spec loaded)"]
    }
  };
}

/**
 * Summarize a full chair response to ~200 words before task extraction.
 *
 * Chair deliberation responses can be 1000+ words. Sending all of them as a
 * single extraction prompt caused timeouts on featherless because the combined
 * prompt was too large for one inference call to complete within the
 * provider's window. Summarizing each response first reduces the extraction
 * prompt from ~6000+ words to ~1500 words.
 *
 * Routes through `enqueueInference()` with `callType: "chair_summarize"`
 * (priority 2, maxConcurrent 3 — short calls that can run in parallel).
 *
 * Non-blocking: on ANY error (NoProviderConfiguredError, QueueFullError,
 * timeout, network error, etc.) returns the original text unchanged. A long
 * extraction prompt is better than no extraction prompt — the extractor's own
 * fallback handles the degraded case.
 *
 * @param chairResponse  Full chair response text (may be 1000+ words).
 * @param workspaceId    Workspace ID — required by the inference queue to
 *                       load workspace settings and resolve the active provider.
 * @param chairId        Optional chair ID, included in call metadata for
 *                       observability.
 * @returns The summarized text (~200 words), or the original text on any error.
 */
export async function summarizeChairResponse(
  chairResponse: string,
  workspaceId: string,
  chairId?: string
): Promise<string> {
  try {
    const result = await enqueueInference({
      callType: "chair_summarize",
      workspaceId,
      prompt: chairResponse,
      systemPrompt:
        "Summarize the following board chair response to approximately 200 words. " +
        "Preserve key decisions, action items, and recommendations. Do not add commentary.",
      temperature: 0.3,
      metadata: chairId ? { chairId } : undefined,
    });
    // Strip any chain-of-thought blocks emitted by thinking models so the
    // summary is clean prose for the downstream extraction prompt.
    const parsed = parseThinking(result.text);
    return parsed.answer;
  } catch {
    // Non-blocking: better to have a long prompt than no prompt.
    // Returns the original text unchanged on any error.
    return chairResponse;
  }
}
