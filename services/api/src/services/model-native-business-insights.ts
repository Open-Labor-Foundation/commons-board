import type { BoardDomain } from "@commons-board/shared";

type InsightInput = {
  subject: string;
  workspaceId: string;
  domain: BoardDomain;
  snapshot: Record<string, number>;
};

export type ModelNativeBusinessInsight = {
  summary: string;
  confidence: number;
  recommendations: string[];
  model: {
    mode: "model_native";
    provider: "local" | "remote";
    source: "remote" | "local_fallback";
  };
};

function envModelProvider(): "local" | "remote" {
  return String(process.env.MODEL_PROVIDER ?? "local").toLowerCase() === "remote" ? "remote" : "local";
}

function normalizeConfidence(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(2));
}

function fallbackInsight(input: InsightInput): ModelNativeBusinessInsight {
  const signalValues = Object.values(input.snapshot);
  const avg = signalValues.length > 0 ? signalValues.reduce((acc, value) => acc + value, 0) / signalValues.length : 0.5;
  const confidence = normalizeConfidence(0.58 + Math.min(0.3, Math.abs(avg - 0.5)));
  const trend = avg >= 0.6 ? "improving" : avg >= 0.45 ? "stable" : "at risk";
  return {
    summary: `${input.subject}: current signal posture is ${trend} for ${input.domain}.`,
    confidence,
    recommendations: [
      "Prioritize top-variance metric and assign one accountable owner.",
      "Set a weekly checkpoint and publish deltas with evidence references.",
      "Trigger cross-domain escalation when risk and throughput diverge."
    ],
    model: {
      mode: "model_native",
      provider: envModelProvider(),
      source: "local_fallback"
    }
  };
}

async function tryRemote(input: InsightInput): Promise<ModelNativeBusinessInsight | null> {
  const url = String(process.env.MODEL_ROUTER_REMOTE_URL ?? "").trim();
  if (!url) return null;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${String(process.env.MODEL_API_KEY ?? "")}`
      },
      body: JSON.stringify({
        task: "business_insight_reasoning",
        schema: "model_native_business_insight_v1",
        subject: input.subject,
        domain: input.domain,
        workspace_id: input.workspaceId,
        snapshot: input.snapshot
      })
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as Partial<ModelNativeBusinessInsight> | null;
    if (!payload || typeof payload.summary !== "string") return null;
    return {
      summary: payload.summary,
      confidence: normalizeConfidence(Number(payload.confidence ?? 0.6)),
      recommendations: Array.isArray(payload.recommendations)
        ? payload.recommendations.map((item) => String(item)).slice(0, 5)
        : ["No recommendations provided by model response."],
      model: {
        mode: "model_native",
        provider: "remote",
        source: "remote"
      }
    };
  } catch {
    return null;
  }
}

export async function resolveModelNativeBusinessInsight(input: InsightInput): Promise<ModelNativeBusinessInsight> {
  if (envModelProvider() === "remote") {
    const remote = await tryRemote(input);
    if (remote) return remote;
  }
  return fallbackInsight(input);
}
