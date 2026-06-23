type SemanticJudgeInput = {
  expectedAction: string;
  observedAction: string;
  context?: Record<string, unknown>;
};

type SemanticJudgeResult = {
  score: number;
  rationale: string[];
  model: {
    mode: "model_native";
    provider: "local" | "remote";
    source: "local_fallback" | "remote";
  };
};

function envModelProvider(): "local" | "remote" {
  return String(process.env.MODEL_PROVIDER ?? "local").toLowerCase() === "remote" ? "remote" : "local";
}

function normalizeScore(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(4));
}

function lexicalSimilarity(a: string, b: string): number {
  const left = new Set(String(a).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const right = new Set(String(b).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  if (left.size === 0 && right.size === 0) return 1;
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union > 0 ? intersection / union : 0;
}

function actionAliases(action: string): string[] {
  const aliasMap = new Map<string, string[]>([
    ["route_to_chair", ["route", "chair", "delegate"]],
    ["request_clarification", ["clarify", "clarification"]],
    ["split_domains", ["split", "multi", "domain"]],
    ["deliver_compensation", ["compensation", "finance"]],
    ["deliver_market_analysis", ["market", "analysis"]],
    ["deliver_promo_material", ["promo", "marketing"]],
    ["deliver_legal_pack", ["legal", "nda"]],
    ["broadcast_response", ["broadcast", "all", "chairs"]]
  ]);
  return aliasMap.get(action) ?? [];
}

function localSemanticScore(expected: string, observed: string): SemanticJudgeResult {
  if (expected === observed) {
    return { score: 1, rationale: ["exact action match"], model: { mode: "model_native", provider: "local", source: "local_fallback" } };
  }
  const expectedHint = `${expected} ${actionAliases(expected).join(" ")}`.trim();
  const observedHint = `${observed} ${actionAliases(observed).join(" ")}`.trim();
  const lexical = lexicalSimilarity(expectedHint, observedHint);
  return {
    score: normalizeScore(lexical),
    rationale: ["lexical-alias semantic fallback"],
    model: { mode: "model_native", provider: "local", source: "local_fallback" }
  };
}

async function tryRemoteJudge(input: SemanticJudgeInput): Promise<SemanticJudgeResult | null> {
  const url = String(process.env.MODEL_SEMANTIC_JUDGE_REMOTE_URL ?? "").trim();
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${String(process.env.MODEL_API_KEY ?? "")}`
      },
      body: JSON.stringify({
        task: "semantic_action_equivalence",
        schema: "semantic_judge_v1",
        expected_action: input.expectedAction,
        observed_action: input.observedAction,
        context: input.context ?? {}
      })
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as { score?: number; rationale?: string[] } | null;
    if (!payload) return null;
    return {
      score: normalizeScore(Number(payload.score ?? 0)),
      rationale: Array.isArray(payload.rationale) ? payload.rationale.map((item) => String(item)) : ["remote semantic judge"],
      model: { mode: "model_native", provider: "remote", source: "remote" }
    };
  } catch {
    return null;
  }
}

export async function resolveSemanticJudge(input: SemanticJudgeInput): Promise<SemanticJudgeResult> {
  if (envModelProvider() === "remote") {
    const remote = await tryRemoteJudge(input);
    if (remote) return remote;
  }
  return localSemanticScore(input.expectedAction, input.observedAction);
}
