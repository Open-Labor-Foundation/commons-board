export type ModelNativeChairTargetingDecision = {
  addressedHandle?: string;
  delegationTargetHandle?: string;
  hasExplicitTarget: boolean;
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

const handleAliasMap: Record<string, string> = {
  "r&d": "rnd",
  "r and d": "rnd",
  "research and development": "rnd",
  cfo: "finance",
  finance: "finance",
  operations: "ops",
  operation: "ops",
  technology: "it",
  tech: "it",
  people: "hr",
  "people ops": "hr",
  "human resources": "hr"
};

function normalizeHandle(value: unknown): string | undefined {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
  const aliased = handleAliasMap[raw] ?? raw;
  const token = aliased.replace(/[^a-z0-9_-]/g, "");
  return token || undefined;
}

function inferRoleMentions(text: string): string[] {
  const mentions: string[] = [];
  const patterns: Array<{ handle: string; regex: RegExp }> = [
    { handle: "it", regex: /\b(?:the\s+)?(?:cio|it)(?:\s+chair)?\b/g },
    { handle: "finance", regex: /\b(?:the\s+)?(?:cfo|finance)(?:\s+chair)?\b/g },
    { handle: "hr", regex: /\b(?:the\s+)?(?:hr|human resources|people ops)(?:\s+chair)?\b/g },
    { handle: "it", regex: /\b(?:the\s+)?(?:information technology|technology chair|it chair|it lead|technology lead)\b/g },
    { handle: "ops", regex: /\b(?:the\s+)?(?:ops|operations)(?:\s+chair)?\b/g },
    { handle: "security", regex: /\b(?:the\s+)?security(?:\s+chair)?\b/g },
    { handle: "legal", regex: /\b(?:the\s+)?legal(?:\s+chair)?\b/g },
    { handle: "rnd", regex: /\b(?:the\s+)?(?:rnd|r&d|research and development)(?:\s+chair)?\b/g },
    { handle: "strategy", regex: /\b(?:the\s+)?strategy(?:\s+chair)?\b/g },
    { handle: "product", regex: /\b(?:the\s+)?product(?:\s+chair)?\b/g },
    { handle: "growth", regex: /\b(?:the\s+)?growth(?:\s+chair)?\b/g },
    { handle: "sales", regex: /\b(?:the\s+)?sales(?:\s+chair)?\b/g },
    { handle: "ethics", regex: /\b(?:the\s+)?ethics(?:\s+chair)?\b/g }
  ];
  for (const pattern of patterns) {
    if (!pattern.regex.test(text)) continue;
    const normalized = normalizeHandle(pattern.handle);
    if (!normalized) continue;
    mentions.push(normalized);
  }
  return [...new Set(mentions)];
}

function classifyFallback(prompt: string): ModelNativeChairTargetingDecision {
  const text = prompt.toLowerCase();
  const allHandles = [...text.matchAll(/@([a-z0-9_-]+)/g)].map((match) => normalizeHandle(match[1])).filter(Boolean) as string[];
  const roleMentions = inferRoleMentions(text);
  const addressedHandle = allHandles[0] ?? roleMentions[0];
  const delegated = text.match(/\bto\s+@([a-z0-9_-]+)/);
  const delegatedNatural = text.match(
    /\b(?:assign|delegate|route|hand off|handoff|send|ask|have|let)\b[\s\S]{0,40}\b(?:to|for)?\s*(?:the\s+)?([a-z&\s]{2,32})(?:\s+chair)?\b/
  );
  const delegationTargetHandle = normalizeHandle(delegated?.[1]) ?? normalizeHandle(delegatedNatural?.[1]);
  const hasDelegationSignal =
    /\b(assign|delegate|route|hand off|handoff|send|ask|have|let)\b/.test(text) && Boolean(delegationTargetHandle);
  const hasDirectiveSignal =
    /\b(provide|build|create|review|analyze|estimate|respond|tell|draft|prepare|design|recommend|lead|own|produce|should|needs?\s+to)\b/.test(text);

  const reasons: string[] = [];
  let confidence = 0.35;
  if (addressedHandle) {
    reasons.push(allHandles[0] ? "direct @handle detected" : "role mention detected");
    confidence += allHandles[0] ? 0.3 : 0.3;
  }
  if (hasDelegationSignal) {
    reasons.push("delegation pattern detected");
    confidence += 0.3;
  }
  if (roleMentions.length > 0 && hasDirectiveSignal) {
    reasons.push("directive phrasing with role mention detected");
    confidence += 0.12;
  }

  const provider = envModelProvider();
  const hasExplicitTarget = Boolean(allHandles.length > 0 || (hasDelegationSignal && delegationTargetHandle) || (roleMentions.length > 0 && hasDirectiveSignal));
  return {
    addressedHandle,
    delegationTargetHandle: hasDelegationSignal ? delegationTargetHandle : undefined,
    hasExplicitTarget,
    confidence: normalizeConfidence(confidence),
    reasons,
    model: { mode: "model_native", provider, source: "local_fallback" }
  };
}

async function tryRemoteDecision(prompt: string): Promise<ModelNativeChairTargetingDecision | null> {
  const url = String(process.env.MODEL_ROUTER_REMOTE_URL ?? "").trim();
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${String(process.env.MODEL_API_KEY ?? "")}`
      },
      body: JSON.stringify({ task: "chair_target_extract", schema: "model_native_chair_targeting_v1", prompt })
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as Partial<ModelNativeChairTargetingDecision> | null;
    if (!payload || typeof payload !== "object") return null;
    const addressedHandle = normalizeHandle(payload.addressedHandle);
    const delegationTargetHandle = normalizeHandle(payload.delegationTargetHandle);
    const hasExplicitTarget = Boolean(payload.hasExplicitTarget ?? addressedHandle ?? delegationTargetHandle);
    return {
      addressedHandle,
      delegationTargetHandle,
      hasExplicitTarget,
      confidence: normalizeConfidence(Number(payload.confidence ?? 0.6)),
      reasons: Array.isArray(payload.reasons) ? payload.reasons.map((item) => String(item)) : ["remote decision"],
      model: { mode: "model_native", provider: "remote", source: "remote" }
    };
  } catch {
    return null;
  }
}

export async function resolveModelNativeChairTargeting(prompt: string): Promise<ModelNativeChairTargetingDecision> {
  if (envModelProvider() === "remote") {
    const remote = await tryRemoteDecision(prompt);
    if (remote) return remote;
  }
  return classifyFallback(prompt);
}
