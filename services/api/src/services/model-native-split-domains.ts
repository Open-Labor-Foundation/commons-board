import type { BoardDomain } from "@commons-board/shared";
import { domainRelevanceScores, normalizeChairType } from "./model-native-semantics.js";

export type ModelNativeSplitDomainsDecision = {
  domains: BoardDomain[];
  confidence: number;
  reasons: string[];
  model: {
    mode: "model_native";
    provider: "local" | "remote";
    source: "remote" | "local_fallback";
  };
};

type ResolveInput = {
  title: string;
  request: string;
  primaryDomain: BoardDomain;
};

function toBoardDomain(value: unknown): BoardDomain | null {
  const normalized = normalizeChairType(value);
  switch (normalized) {
    case "ops":
    case "it":
    case "hr":
    case "security":
    case "rnd":
    case "finance":
    case "growth":
    case "sales":
    case "legal":
    case "product":
    case "strategy":
      return normalized;
    default:
      return null;
  }
}

function envModelProvider(): "local" | "remote" {
  return String(process.env.MODEL_PROVIDER ?? "local").toLowerCase() === "remote" ? "remote" : "local";
}

function normalizeConfidence(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(2));
}

function fallbackDecision(input: ResolveInput): ModelNativeSplitDomainsDecision {
  const text = `${input.title} ${input.request}`.toLowerCase();
  const collaborationSignal =
    /\b(with|including|include|support|supported by|involving|joint|cross-domain|across|plus|alongside)\b/.test(text);
  const scored = domainRelevanceScores(text)
    .filter((entry) => entry.domain !== input.primaryDomain)
    .filter((entry) => entry.score >= 0.18 || entry.matches >= 1);
  const inferred = (collaborationSignal ? scored : scored.filter((entry) => entry.matches >= 2 || entry.score >= 0.28))
    .slice(0, 4)
    .map((entry) => entry.domain);
  const reasons: string[] = [];
  let confidence = 0.35;
  if (collaborationSignal) { reasons.push("collaboration signal detected"); confidence += 0.2; }
  if (inferred.length > 0) { reasons.push("domain mentions detected"); confidence += Math.min(0.35, inferred.length * 0.08); }
  return {
    domains: inferred,
    confidence: normalizeConfidence(confidence),
    reasons,
    model: { mode: "model_native", provider: envModelProvider(), source: "local_fallback" }
  };
}

async function tryRemoteDecision(input: ResolveInput): Promise<ModelNativeSplitDomainsDecision | null> {
  const url = String(process.env.MODEL_ROUTER_REMOTE_URL ?? "").trim();
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${String(process.env.MODEL_API_KEY ?? "")}`
      },
      body: JSON.stringify({ task: "split_domain_extract", schema: "model_native_split_domains_v1", input })
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as Partial<ModelNativeSplitDomainsDecision> | null;
    if (!payload || typeof payload !== "object") return null;
    const local = fallbackDecision(input);
    const candidates = Array.isArray(payload.domains) ? payload.domains : [];
    const domains = [...new Set(candidates.map((item) => toBoardDomain(item)).filter((item): item is BoardDomain => Boolean(item)))]
      .filter((item) => item !== input.primaryDomain);
    return {
      domains: domains.length > 0 ? domains : local.domains,
      confidence: normalizeConfidence(Number(payload.confidence ?? (domains.length > 0 ? 0.7 : local.confidence))),
      reasons: Array.isArray(payload.reasons) ? payload.reasons.map((item) => String(item)) : ["remote decision"],
      model: { mode: "model_native", provider: "remote", source: "remote" }
    };
  } catch {
    return null;
  }
}

export async function resolveModelNativeSplitDomains(input: ResolveInput): Promise<ModelNativeSplitDomainsDecision> {
  if (envModelProvider() === "remote") {
    const remote = await tryRemoteDecision(input);
    if (remote) return remote;
  }
  return fallbackDecision(input);
}
