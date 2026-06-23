import type { BoardDomain } from "@commons-board/shared";

export type ExceptionSeverity = "low" | "medium" | "high" | "critical";
export type ExceptionCategory =
  | "runtime_failure"
  | "connector_auth"
  | "policy_enforcement"
  | "data_contract"
  | "infrastructure"
  | "unknown";

export type DeadLetterRecord = {
  id: string;
  workspace_id: string;
  source: string;
  reason: string;
  payload: Record<string, unknown>;
  created_at: string;
};

type ModelNativeExceptionDecision = {
  severity: ExceptionSeverity;
  category: ExceptionCategory;
  remediationDomain: BoardDomain;
  factors: string[];
  actions: string[];
  confidence: number;
  reasons: string[];
  model: {
    mode: "model_native";
    provider: "local" | "remote";
    source: "remote" | "local_fallback";
  };
};

function parseErrorText(deadLetter: DeadLetterRecord): string {
  const payload = deadLetter.payload ?? {};
  const err = typeof payload.error === "string" ? payload.error : "";
  return `${deadLetter.source} ${deadLetter.reason} ${err}`.toLowerCase();
}

function normalizeConfidence(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(2));
}

function envModelProvider(): "local" | "remote" {
  return String(process.env.MODEL_PROVIDER ?? "local").toLowerCase() === "remote" ? "remote" : "local";
}

function classifyLocal(deadLetter: DeadLetterRecord): Omit<ModelNativeExceptionDecision, "confidence" | "reasons" | "model"> {
  const text = parseErrorText(deadLetter);
  if (/token|auth|unauthorized|401|forbidden|expired/.test(text)) {
    return {
      severity: "high",
      category: "connector_auth",
      remediationDomain: "it",
      factors: ["credential_expiry", "connector_auth_state"],
      actions: ["rotate connector credentials", "re-run connector health checks", "confirm least-privilege scopes"]
    };
  }
  if (/verification policy|approval|contract|legal|evidence|court|governance/.test(text)) {
    return {
      severity: "medium",
      category: "policy_enforcement",
      remediationDomain: "ops",
      factors: ["policy_gate_rejection", "approval_gap"],
      actions: ["review required approvals", "update response workflow playbook", "re-submit after verification"]
    };
  }
  if (/schema|validation|payload|json/.test(text)) {
    return {
      severity: "medium",
      category: "data_contract",
      remediationDomain: "it",
      factors: ["payload_shape_mismatch", "contract_drift"],
      actions: ["validate upstream payload contracts", "add stricter schema tests", "deploy contract compatibility patch"]
    };
  }
  if (/docker|container|database|connection|timeout|econn|resource/.test(text)) {
    return {
      severity: deadLetter.source === "cadence.run" ? "critical" : "high",
      category: "infrastructure",
      remediationDomain: "it",
      factors: ["runtime_dependency_failure", "infrastructure_instability"],
      actions: ["stabilize infrastructure dependency", "execute incident checklist", "verify runtime receipts and retries"]
    };
  }
  if (/runtime|execution|cadence|worker/.test(text)) {
    return {
      severity: deadLetter.source === "cadence.run" ? "critical" : "high",
      category: "runtime_failure",
      remediationDomain: "ops",
      factors: ["runtime_exception", "execution_pipeline_interrupt"],
      actions: ["run root cause analysis", "prepare rollback/forward fix", "validate with deterministic replay"]
    };
  }
  return {
    severity: "medium",
    category: "unknown",
    remediationDomain: "ops",
    factors: ["insufficient_error_signal"],
    actions: ["collect additional telemetry", "assign owner for manual triage"]
  };
}

async function tryRemoteDecision(deadLetter: DeadLetterRecord): Promise<ModelNativeExceptionDecision | null> {
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
        task: "exception_triage_classify",
        schema: "model_native_exception_triage_v1",
        dead_letter: { id: deadLetter.id, source: deadLetter.source, reason: deadLetter.reason, payload: deadLetter.payload ?? {} }
      })
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as Partial<ModelNativeExceptionDecision> | null;
    if (!payload || typeof payload !== "object") return null;
    const local = classifyLocal(deadLetter);
    return {
      severity: payload.severity ?? local.severity,
      category: payload.category ?? local.category,
      remediationDomain: payload.remediationDomain ?? local.remediationDomain,
      factors: Array.isArray(payload.factors) ? payload.factors.map((item) => String(item)) : local.factors,
      actions: Array.isArray(payload.actions) ? payload.actions.map((item) => String(item)) : local.actions,
      confidence: normalizeConfidence(Number(payload.confidence ?? 0.65)),
      reasons: Array.isArray(payload.reasons) ? payload.reasons.map((item) => String(item)) : ["remote decision"],
      model: { mode: "model_native", provider: "remote", source: "remote" }
    };
  } catch {
    return null;
  }
}

export async function resolveModelNativeExceptionTriage(deadLetter: DeadLetterRecord): Promise<ModelNativeExceptionDecision> {
  const provider = envModelProvider();
  if (provider === "remote") {
    const remote = await tryRemoteDecision(deadLetter);
    if (remote) return remote;
  }
  const local = classifyLocal(deadLetter);
  return {
    ...local,
    confidence: 0.62,
    reasons: ["local fallback classifier"],
    model: { mode: "model_native", provider, source: "local_fallback" }
  };
}
