import { KNOWN_DOMAINS, cueMatchCount, normalizeChairType, textHasCue } from "./model-native-semantics.js";

type OrgActionIntent = "chair_provision" | "other";

export type ModelNativeOrgActionDecision = {
  intent: OrgActionIntent;
  autoProvision: boolean;
  requestedChairTypes: string[];
  confidence: number;
  reasons: string[];
  model: {
    mode: "model_native";
    provider: "local" | "remote";
    source: "remote" | "local_fallback";
  };
};

const blockedChairTokens = new Set([
  "this", "that", "these", "all", "the", "each", "every",
  "board", "recommended", "initial", "startup", "core", "possible"
]);

const knownChairTypes = new Set([...KNOWN_DOMAINS, "ethics"]);

function normalizeConfidence(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(2));
}

function normalizeChairToken(value: unknown): string {
  const alias = normalizeChairType(value);
  if (!alias || blockedChairTokens.has(alias)) return "";
  return alias;
}

function envModelProvider(): "local" | "remote" {
  return String(process.env.MODEL_PROVIDER ?? "local").toLowerCase() === "remote" ? "remote" : "local";
}

export function extractRequestedChairTypesModelFallback(prompt: string): string[] {
  const result = new Set<string>();
  const directRolePattern = /\b([a-z][a-z0-9&/ -]{1,40})\s+(?:chair|lead|owner|head)\b/gi;
  for (const match of prompt.matchAll(directRolePattern)) {
    const token = normalizeChairToken(match[1]);
    if (!token || !knownChairTypes.has(token)) continue;
    result.add(token);
  }
  return [...result];
}

function autoProvisionFallback(prompt: string): boolean {
  const text = prompt.toLowerCase();
  const actionScore = cueMatchCount(text, ["add", "create", "form", "build", "stand up", "provision", "populate", "need", "require", "start with"]);
  const roleScore = cueMatchCount(text, ["chair", "chairs", "board", "suite", "executive", "lead", "owner"]);
  const domainScore = [...knownChairTypes].reduce((count, type) => (textHasCue(text, type) ? count + 1 : count), 0);
  return actionScore > 0 && roleScore > 0 && domainScore > 0;
}

export function deriveModelNativeOrgActionFallback(prompt: string): ModelNativeOrgActionDecision {
  const provider = envModelProvider();
  const lower = prompt.toLowerCase();
  const hasHandleMention = /@[a-z0-9_-]+/i.test(prompt);
  const semanticProvisionSignal = cueMatchCount(lower, ["add", "create", "form", "provision", "populate", "board suite", "new chair", "need"]) > 0;
  const requestedChairTypes = new Set<string>(hasHandleMention && !semanticProvisionSignal ? [] : extractRequestedChairTypesModelFallback(prompt));
  if (semanticProvisionSignal) {
    for (const candidate of knownChairTypes) {
      if (textHasCue(lower, candidate)) requestedChairTypes.add(candidate);
    }
  }
  const autoProvision = autoProvisionFallback(prompt);
  const requested = [...requestedChairTypes];
  const intent: OrgActionIntent = requested.length > 0 || autoProvision ? "chair_provision" : "other";
  const reasons: string[] = [];
  let confidence = 0.35;
  if (requested.length > 0) {
    reasons.push("role/domain semantics detected");
    confidence += Math.min(0.35, 0.15 + requested.length * 0.07);
  }
  if (autoProvision) {
    reasons.push("provisioning intent semantics detected");
    confidence += 0.2;
  }
  return {
    intent,
    autoProvision,
    requestedChairTypes: requested,
    confidence: normalizeConfidence(confidence),
    reasons,
    model: { mode: "model_native", provider, source: "local_fallback" }
  };
}

async function tryRemoteDecision(prompt: string): Promise<ModelNativeOrgActionDecision | null> {
  const url = String(process.env.MODEL_ROUTER_REMOTE_URL ?? "").trim();
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${String(process.env.MODEL_API_KEY ?? "")}`
      },
      body: JSON.stringify({ task: "org_action_extract", schema: "model_native_org_action_v1", prompt })
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as Partial<ModelNativeOrgActionDecision> | null;
    if (!payload || typeof payload.intent !== "string") return null;
    return {
      intent: payload.intent === "chair_provision" ? "chair_provision" : "other",
      autoProvision: Boolean(payload.autoProvision),
      requestedChairTypes: Array.isArray(payload.requestedChairTypes)
        ? [...new Set(payload.requestedChairTypes.map((item) => normalizeChairToken(item)).filter(Boolean))]
        : [],
      confidence: normalizeConfidence(Number(payload.confidence ?? 0.5)),
      reasons: Array.isArray(payload.reasons) ? payload.reasons.map((item) => String(item)) : ["remote decision"],
      model: { mode: "model_native", provider: "remote", source: "remote" }
    };
  } catch {
    return null;
  }
}

export async function resolveModelNativeOrgAction(prompt: string): Promise<ModelNativeOrgActionDecision> {
  if (envModelProvider() === "remote") {
    const remote = await tryRemoteDecision(prompt);
    if (remote) return remote;
  }
  return deriveModelNativeOrgActionFallback(prompt);
}
