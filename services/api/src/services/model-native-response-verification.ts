import type { BoardDomain } from "@commons-board/shared";

export type ModelNativeResponseVerificationDecision = {
  requiresLegalEvidenceVerification: boolean;
  confidence: number;
  reasons: string[];
  model: {
    mode: "model_native";
    provider: "local" | "remote";
    source: "remote" | "local_fallback";
  };
};

function normalizeConfidence(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(2));
}

function envModelProvider(): "local" | "remote" {
  return String(process.env.MODEL_PROVIDER ?? "local").toLowerCase() === "remote" ? "remote" : "local";
}

function fallbackDecision(input: { targetDomain: BoardDomain; text: string }): ModelNativeResponseVerificationDecision {
  const requires =
    input.targetDomain === "legal" ||
    /(policy|contract|legal|evidence|court|regulatory|compliance|binding agreement|nda)/i.test(input.text);
  const reasons = requires ? ["legal/evidence terms detected"] : ["no legal/evidence terms detected"];
  return {
    requiresLegalEvidenceVerification: requires,
    confidence: requires ? 0.75 : 0.62,
    reasons,
    model: { mode: "model_native", provider: envModelProvider(), source: "local_fallback" }
  };
}

async function tryRemoteDecision(input: {
  targetDomain: BoardDomain;
  requestTitle: string;
  requestText: string;
  responseText: string;
}): Promise<ModelNativeResponseVerificationDecision | null> {
  const url = String(process.env.MODEL_ROUTER_REMOTE_URL ?? "").trim();
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${String(process.env.MODEL_API_KEY ?? "")}`
      },
      body: JSON.stringify({ task: "response_verification_classify", schema: "model_native_response_verification_v1", input })
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as Partial<ModelNativeResponseVerificationDecision> | null;
    if (!payload || typeof payload !== "object") return null;
    return {
      requiresLegalEvidenceVerification: Boolean(payload.requiresLegalEvidenceVerification),
      confidence: normalizeConfidence(Number(payload.confidence ?? 0.6)),
      reasons: Array.isArray(payload.reasons) ? payload.reasons.map((item) => String(item)) : ["remote decision"],
      model: { mode: "model_native", provider: "remote", source: "remote" }
    };
  } catch {
    return null;
  }
}

export async function resolveModelNativeResponseVerification(input: {
  targetDomain: BoardDomain;
  requestTitle: string;
  requestText: string;
  responseText: string;
}): Promise<ModelNativeResponseVerificationDecision> {
  if (envModelProvider() === "remote") {
    const remote = await tryRemoteDecision(input);
    if (remote) return remote;
  }
  return fallbackDecision({ targetDomain: input.targetDomain, text: `${input.requestTitle} ${input.requestText}` });
}
