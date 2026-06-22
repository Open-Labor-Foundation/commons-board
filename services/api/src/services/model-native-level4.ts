/**
 * Model-native outreach reply classifier.
 *
 * Ported from mother-board services/model-native-level4.ts.
 * No OLF-specific sanitization needed — no store dependencies, no org branding.
 *
 * Classification priority: remote model → local keyword fallback.
 * MODEL_PROVIDER env controls whether to attempt remote first.
 * MODEL_ROUTER_REMOTE_URL + MODEL_API_KEY for remote calls.
 */

export type OutreachReplyClassification = "interested" | "not_now" | "unsubscribe" | "complaint";

export type ModelNativeOutreachDecision = {
  classification: OutreachReplyClassification;
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

function classifyFallback(body: string): ModelNativeOutreachDecision {
  const text = body.toLowerCase();
  if (text.includes("unsubscribe") || text.includes("remove me")) {
    return {
      classification: "unsubscribe",
      confidence: 0.92,
      reasons: ["unsubscribe intent tokens detected"],
      model: { mode: "model_native", provider: envModelProvider(), source: "local_fallback" }
    };
  }
  if (text.includes("complaint") || text.includes("spam")) {
    return {
      classification: "complaint",
      confidence: 0.88,
      reasons: ["complaint intent tokens detected"],
      model: { mode: "model_native", provider: envModelProvider(), source: "local_fallback" }
    };
  }
  if (text.includes("not now") || text.includes("later")) {
    return {
      classification: "not_now",
      confidence: 0.81,
      reasons: ["deferral intent tokens detected"],
      model: { mode: "model_native", provider: envModelProvider(), source: "local_fallback" }
    };
  }
  return {
    classification: "interested",
    confidence: 0.65,
    reasons: ["no suppression/complaint tokens detected"],
    model: { mode: "model_native", provider: envModelProvider(), source: "local_fallback" }
  };
}

async function tryRemoteDecision(body: string): Promise<ModelNativeOutreachDecision | null> {
  const url = String(process.env.MODEL_ROUTER_REMOTE_URL ?? "").trim();
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${String(process.env.MODEL_API_KEY ?? "")}`
      },
      body: JSON.stringify({
        task: "outreach_reply_classify",
        schema: "model_native_outreach_reply_v1",
        body
      })
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as Partial<ModelNativeOutreachDecision> | null;
    const classification = String(payload?.classification ?? "");
    if (
      classification !== "interested" &&
      classification !== "not_now" &&
      classification !== "unsubscribe" &&
      classification !== "complaint"
    ) {
      return null;
    }
    return {
      classification: classification as OutreachReplyClassification,
      confidence: normalizeConfidence(Number(payload?.confidence ?? 0.5)),
      reasons: Array.isArray(payload?.reasons)
        ? payload!.reasons!.map((item) => String(item))
        : ["remote decision"],
      model: { mode: "model_native", provider: "remote", source: "remote" }
    };
  } catch {
    return null;
  }
}

export async function resolveModelNativeOutreachReply(body: string): Promise<ModelNativeOutreachDecision> {
  const provider = envModelProvider();
  if (provider === "remote") {
    const remote = await tryRemoteDecision(body);
    if (remote) return remote;
  }
  return classifyFallback(body);
}
