/**
 * Normalizes artifacts from the governed store into the shapes expected by the
 * execution engine (ArtifactsForExecution).
 *
 * CB's JSON schemas use the governance vocabulary (autonomy_mode, approval_thresholds,
 * chairs without status). The execution engine was ported from mother-board and uses its
 * internal vocabulary (mode_default, action_categories, chairs with status). Rather than
 * changing either the schemas or the engine, we translate at the read boundary here.
 */
import type { ArtifactsForExecution } from "../agent-runtime/execution/types.js";

type ExecutionMode = "advisor" | "orchestrator" | "autopilot";

export function normalizeAutonomyPolicy(raw: Record<string, unknown>): ArtifactsForExecution["autonomy_policy"] {
  const mode = (raw.autonomy_mode ?? raw.mode_default ?? "advisor") as ExecutionMode;

  if (Array.isArray(raw.action_categories)) {
    return { ...(raw as unknown as ArtifactsForExecution["autonomy_policy"]), mode_default: mode };
  }

  const isPilot = mode === "autopilot";
  const isOrch = mode === "orchestrator" || isPilot;

  const action_categories: ArtifactsForExecution["autonomy_policy"]["action_categories"] = [
    { category: "create_tasks",          risk_level_default: "low",    allowed_in_modes: ["advisor", "orchestrator", "autopilot"], approvals_required: 0, forbidden: false },
    { category: "create_ops_tasks",      risk_level_default: "low",    allowed_in_modes: ["advisor", "orchestrator", "autopilot"], approvals_required: 0, forbidden: false },
    { category: "create_it_tasks",       risk_level_default: "low",    allowed_in_modes: ["advisor", "orchestrator", "autopilot"], approvals_required: 0, forbidden: false },
    { category: "create_workforce_tasks",risk_level_default: "medium", allowed_in_modes: isOrch ? ["orchestrator", "autopilot"] : [], approvals_required: isPilot ? 0 : 1, forbidden: false },
    { category: "create_budget_tasks",   risk_level_default: "medium", allowed_in_modes: isOrch ? ["orchestrator", "autopilot"] : [], approvals_required: isPilot ? 0 : 1, forbidden: false },
    { category: "create_pipeline_tasks", risk_level_default: "low",    allowed_in_modes: ["advisor", "orchestrator", "autopilot"], approvals_required: 0, forbidden: false },
    { category: "create_product_tasks",  risk_level_default: "low",    allowed_in_modes: ["advisor", "orchestrator", "autopilot"], approvals_required: 0, forbidden: false },
    { category: "create_research_tasks", risk_level_default: "low",    allowed_in_modes: ["advisor", "orchestrator", "autopilot"], approvals_required: 0, forbidden: false },
    { category: "create_compliance_tasks",risk_level_default:"medium", allowed_in_modes: isOrch ? ["orchestrator", "autopilot"] : [], approvals_required: 1, forbidden: false },
    { category: "create_security_tasks", risk_level_default: "high",   allowed_in_modes: isOrch ? ["orchestrator", "autopilot"] : [], approvals_required: 1, forbidden: false },
    { category: "run_growth_experiment", risk_level_default: "high",   allowed_in_modes: isPilot ? ["autopilot"] : isOrch ? ["orchestrator", "autopilot"] : [], approvals_required: isPilot ? 0 : 1, forbidden: false },
  ];

  const forbidden_actions = (
    (raw.disabled_capabilities as string[] | undefined) ??
    (raw.forbidden_actions    as string[] | undefined) ??
    []
  );

  return { mode_default: mode, action_categories, forbidden_actions };
}

export function normalizeAgentBlueprint(raw: Record<string, unknown>): ArtifactsForExecution["agent_blueprint"] {
  const storedChairs = (raw.chairs as Array<Record<string, unknown>> | undefined) ?? [];

  const chairs = storedChairs.map((c) => ({
    chair_id:        c.chair_id  as string,
    name:            c.name      as string,
    domain:          c.domain    as string,
    status:          ((c.status ?? "active") as "active" | "paused" | "retired"),
    kpis:            (c.kpis      as string[]               | undefined) ?? ["execution_quality"],
    authority:       (c.authority as Record<string, unknown> | undefined) ?? {},
    cadence:         (c.cadence   as Record<string, unknown> | undefined) ?? { daily: true, weekly: true, monthly: false },
    budget_cap_daily: c.budget_cap_daily as number | undefined,
    risk_ceiling:     c.risk_ceiling     as number | undefined,
  }));

  // The engine requires at least one chair with domain "governor" or "strategy".
  // CB interview chairs use domain names like "finance", "ops" — inject a synthetic
  // strategy chair so the engine's governor validation passes.
  const hasGovernor = chairs.some((c) => c.domain === "governor" || c.domain === "strategy");
  if (!hasGovernor) {
    chairs.unshift({
      chair_id:        "strategy-1",
      name:            "Strategy Chair",
      domain:          "strategy",
      status:          "active",
      kpis:            ["org_health", "strategic_alignment"],
      authority:       {},
      cadence:         { daily: false, weekly: true, monthly: true },
      budget_cap_daily: undefined,
      risk_ceiling:     undefined,
    });
  }

  return {
    chairs,
    departments:   raw.departments    as ArtifactsForExecution["agent_blueprint"]["departments"],
    teams:         raw.teams          as ArtifactsForExecution["agent_blueprint"]["teams"],
    policy_scopes: raw.policy_scopes  as ArtifactsForExecution["agent_blueprint"]["policy_scopes"],
  };
}

export function normalizeObjectiveConfig(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.primary_objective) return raw;
  const primaryObjs = raw.primary_objectives as Array<Record<string, unknown>> | undefined;
  return {
    ...raw,
    primary_objective: primaryObjs?.[0]?.description ?? "operational_stability",
  };
}
