/**
 * Model-native semantics — domain relevance scoring and text normalization.
 *
 * Ported from mother-board services/model-native-semantics.ts.
 * Sanitized: removed "cio" domain (maps to "it"/"strategy" in commons-board).
 */
import type { BoardDomain } from "@commons-board/shared";

export const KNOWN_DOMAINS: BoardDomain[] = [
  "ops", "it", "security", "hr", "rnd", "finance",
  "growth", "sales", "legal", "product", "strategy"
];

export const DOMAIN_CUES: Record<BoardDomain, string[]> = {
  ops:      ["ops", "operations", "operating", "workflow", "execution", "cadence", "throughput", "process"],
  it:       ["information technology", "it operations", "infrastructure", "service desk", "endpoint", "network", "admin systems", "architecture", "platform strategy", "enterprise systems"],
  security: ["security", "incident", "vulnerability", "controls", "soc2", "iso", "risk management", "threat"],
  hr:       ["hr", "human resources", "people ops", "hiring", "workforce", "talent", "onboarding", "headcount"],
  rnd:      ["r&d", "rnd", "research and development", "research", "prototype", "innovation", "experiment", "feasibility"],
  finance:  ["finance", "cfo", "budget", "forecast", "runway", "valuation", "equity", "ownership", "retainer", "compensation", "term sheet"],
  growth:   ["growth", "marketing", "acquisition", "retention", "go-to-market", "gtm", "campaign", "demand generation"],
  sales:    ["sales", "pipeline", "deal", "prospect", "close rate", "revenue operations", "quota"],
  legal:    ["legal", "contract", "agreement", "nda", "non-disclosure", "compliance", "regulatory", "counsel"],
  product:  ["product", "roadmap", "feature", "ux", "customer value", "adoption", "requirements"],
  strategy: ["strategy", "strategic", "portfolio", "market analysis", "positioning", "competition", "tam", "sam", "som"]
};

export const CHAIR_ALIASES: Record<string, string> = {
  "r&d": "rnd",
  "r and d": "rnd",
  "research and development": "rnd",
  "people ops": "hr",
  "human resources": "hr",
  operations: "ops",
  operation: "ops",
  "chief information officer": "it",
  cio: "it",
  cfo: "finance",
  "chief financial officer": "finance",
  "information technology": "it",
  technology: "it",
  tech: "it"
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function textHasCue(text: string, cue: string): boolean {
  const normalized = cue.trim().toLowerCase();
  if (!normalized) return false;
  if (/^[a-z0-9_-]+$/.test(normalized)) {
    return new RegExp(`\\b${escapeRegex(normalized)}\\b`, "i").test(text);
  }
  return text.includes(normalized);
}

export function cueMatchCount(text: string, cues: string[]): number {
  const normalized = text.toLowerCase();
  return cues.reduce((count, cue) => (textHasCue(normalized, cue) ? count + 1 : count), 0);
}

export function domainRelevanceScores(text: string): Array<{ domain: BoardDomain; score: number; matches: number }> {
  const normalized = text.toLowerCase();
  return KNOWN_DOMAINS.map((domain) => {
    const cues = DOMAIN_CUES[domain];
    const matches = cueMatchCount(normalized, cues);
    const coverage = cues.length > 0 ? matches / cues.length : 0;
    const score = Number((matches * 0.12 + coverage * 0.6).toFixed(4));
    return { domain, score, matches };
  }).sort((a, b) => b.score - a.score);
}

export function normalizeChairAlias(value: unknown): string {
  const raw = String(value ?? "").trim().toLowerCase();
  return CHAIR_ALIASES[raw] ?? raw;
}

export function normalizeChairType(value: unknown): string {
  const raw = normalizeChairAlias(value);
  return raw.replace(/[^a-z0-9_-]/g, "");
}
