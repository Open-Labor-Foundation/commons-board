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
import type { BoardDomain, BoardRequestRecord, BoardRoadmapRecord } from "@commons-board/shared";

type ReasoningInput = {
  request: BoardRequestRecord;
  roadmap: BoardRoadmapRecord;
  laborCommonsSlug?: string;
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

  // Load authority sources from labor-commons specialist spec (if available)
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

  const text = [
    `${input.request.target_domain.toUpperCase()} recommendation for "${compact(input.request.title)}"`,
    "",
    summarizeScope(input.request),
    "",
    "Reasoning:",
    ...domainLens.map((item) => `- ${item}`),
    ...(specialistContext.length > 0 ? ["", "Specialist scope notes:", ...specialistContext.map((s) => `- ${s}`)] : []),
    "",
    "Recommended next actions (sequenced):",
    "- Stage 1: lock scope, constraints, and governance obligations in writing.",
    "- Stage 2: define measurable success criteria with explicit acceptance gates.",
    "- Stage 3: run initial tranche with weekly governance checkpoint and risk log.",
    "- Stage 4: confirm outcomes against success criteria before scaling.",
    "",
    "Risk controls:",
    "- Do not start execution without signed scope and payment/resource schedule.",
    "- Treat legal and compliance checks as release gates, not post-hoc cleanup.",
    "- Use immutable audit receipts for major recommendations and approvals.",
    "",
    "Evidence signals:",
    ...evidence.map((item) => `- ${item}`),
    ...(citations.length > 0 ? ["", "Authority sources:", ...citations.map((c) => `- ${c}`)] : []),
    "",
    `Confidence: ${(confidence * 100).toFixed(0)}%`
  ].join("\n");

  return {
    responseText: text,
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
