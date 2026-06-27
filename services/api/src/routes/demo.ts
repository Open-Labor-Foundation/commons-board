/**
 * Demo mode — seeds a workspace with governing artifacts and runs the first
 * execution + cadence cycle so a new user can see the system work immediately.
 *
 * Ported from mother-board routes/demo.ts.
 * Sanitized: uses CB artifact schemas (org_id, governance_mode, chairs[]) not
 * MB schemas (company_name, agents[]). Uses writeArtifact + normalizeAutonomyPolicy
 * instead of store.createArtifact.
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { GovernanceEvent } from "@commons-board/shared";
import { requireContext } from "../lib/auth.js";
import { getArtifact, writeArtifact } from "../lib/artifact-store.js";
import { appendEvent } from "../lib/decision-log.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";
import { runAgentExecution } from "../agent-runtime/execution/engine.js";
import { normalizeAutonomyPolicy, normalizeAgentBlueprint, normalizeObjectiveConfig } from "../lib/artifact-normalize.js";

export const demoRouter = Router();
demoRouter.use(requireContext);

/** POST /api/v1/demo/try */
demoRouter.post("/try", async (req: Request, res: Response) => {
  const workspaceId = req.ctx!.workspaceId;
  const actor = req.ctx!.userId;
  const now = new Date().toISOString();

  // Seed business_profile if absent
  if (!getArtifact(workspaceId, "business_profile")) {
    try {
      writeArtifact(workspaceId, "business_profile", {
        org_id: workspaceId,
        org_name: "Demo Organization",
        governance_mode: "business",
        description: "A demo workspace to explore commons-board capabilities.",
        industry: "general",
        primary_domain: "ops",
        operating_since: null,
        location: { primary: "United States", regions: [] },
        size: { headcount: 5, member_count: null },
        external_systems: [],
        created_at: now,
        schema_version: "1.0"
      }, actor);
    } catch { /* skip if schema mismatch */ }
  }

  // Seed objective_config if absent
  if (!getArtifact(workspaceId, "objective_config")) {
    try {
      writeArtifact(workspaceId, "objective_config", {
        org_id: workspaceId,
        primary_objectives: [
          {
            id: "obj-1",
            description: "Achieve operational stability and sustainable growth",
            type: "revenue",
            priority: 1,
            success_criteria: ["Stable daily operations", "Positive weekly throughput trend"],
            target_date: null
          }
        ],
        kpis: [
          { id: "kpi-1", name: "Weekly throughput", unit: "tasks", current_value: null, target_value: 10, reporting_cadence: "weekly" }
        ],
        constraints: [],
        schema_version: "1.0"
      }, actor);
    } catch { /* skip */ }
  }

  // Seed autonomy_policy if absent
  if (!getArtifact(workspaceId, "autonomy_policy")) {
    try {
      writeArtifact(workspaceId, "autonomy_policy", {
        org_id: workspaceId,
        autonomy_mode: "advisor",
        execution_mode: "sim",
        approval_thresholds: {
          financial_spend_auto_limit: 0,
          outreach_auto_limit: 0,
          content_publish_requires_approval: true,
          external_write_requires_approval: true
        },
        disabled_capabilities: [],
        hr_agent_enabled: false,
        per_person_analytics_enabled: false,
        slack_dm_enabled: false,
        slack_channel_whitelist: [],
        risk_escalation_threshold: 60,
        blast_radius_escalation_threshold: "medium",
        schema_version: "1.0"
      }, actor);
    } catch { /* skip */ }
  }

  // Seed cadence_protocol if absent
  if (!getArtifact(workspaceId, "cadence_protocol")) {
    try {
      writeArtifact(workspaceId, "cadence_protocol", {
        org_id: workspaceId,
        daily: { enabled: true, run_at: "08:30", timezone: "America/Chicago", delivery: ["crew-bridge"], output: "pulse" },
        weekly: { enabled: true, run_at: "09:00", timezone: "America/Chicago", delivery: ["crew-bridge"], run_on: "monday", output: "brief", chairs_included: [] },
        monthly: { enabled: false, run_on_day: 1, output: "review", delivery: [] },
        schema_version: "1.0"
      }, actor);
    } catch { /* skip */ }
  }

  // Seed agent_blueprint if absent
  if (!getArtifact(workspaceId, "agent_blueprint")) {
    try {
      writeArtifact(workspaceId, "agent_blueprint", {
        org_id: workspaceId,
        chairs: [
          {
            chair_id: "strategy-1",
            name: "Strategy Chair",
            domain: "strategy",
            description: "Coordinates long-range priorities and strategic planning.",
            labor_commons_refs: [],
            scope: { owns: ["strategic_planning", "portfolio_review"], refuses: [], escalates_to: [] },
            worker_agents: [{ agent_id: "strategy-worker-1", name: "Strategy Analyst", labor_commons_ref: null, task_scope: ["market_analysis", "roadmap_planning"] }],
            approval_required_for: []
          },
          {
            chair_id: "finance-1",
            name: "Finance Chair",
            domain: "finance",
            description: "Oversees financial health, budgeting, and treasury.",
            labor_commons_refs: [],
            scope: { owns: ["budget_approval", "financial_reporting"], refuses: ["hiring_decisions"], escalates_to: [] },
            worker_agents: [{ agent_id: "finance-worker-1", name: "Finance Analyst", labor_commons_ref: null, task_scope: ["expense_review", "runway_calculation"] }],
            approval_required_for: ["financial_spend_above_threshold"]
          },
          {
            chair_id: "ops-1",
            name: "Ops Chair",
            domain: "ops",
            description: "Manages operational rhythm and cross-domain execution.",
            labor_commons_refs: [],
            scope: { owns: ["ops_planning", "throughput_reporting"], refuses: ["financial_commitments"], escalates_to: ["finance-1"] },
            worker_agents: [{ agent_id: "ops-worker-1", name: "Ops Analyst", labor_commons_ref: null, task_scope: ["process_review", "cycle_time_metrics"] }],
            approval_required_for: ["external_write"]
          }
        ],
        schema_version: "1.0"
      }, actor);
    } catch { /* skip */ }
  }

  // Run execution with normalized artifacts
  const bp = getArtifact(workspaceId, "business_profile");
  const oc = getArtifact(workspaceId, "objective_config");
  const ap = getArtifact(workspaceId, "autonomy_policy");
  const cp = getArtifact(workspaceId, "cadence_protocol");
  const ab = getArtifact(workspaceId, "agent_blueprint");

  if (!bp || !oc || !ap || !cp || !ab) {
    res.status(422).json({ error: "failed to seed required artifacts" });
    return;
  }

  let run: ReturnType<typeof runAgentExecution>;
  try {
    run = runAgentExecution({
      business_profile: bp.payload as Record<string, unknown>,
      objective_config: normalizeObjectiveConfig(oc.payload as Record<string, unknown>),
      autonomy_policy: normalizeAutonomyPolicy(ap.payload as Record<string, unknown>),
      cadence_protocol: cp.payload as Record<string, unknown>,
      agent_blueprint: normalizeAgentBlueprint(ab.payload as Record<string, unknown>)
    });
  } catch (err) {
    res.status(500).json({ error: "execution failed during demo", detail: err instanceof Error ? err.message : "unknown" });
    return;
  }

  // Build an inline brief from the run
  const autoApproved = run.actions.filter((a) => a.governor_decision === "auto_approved");
  const headline = autoApproved.length > 0
    ? `${autoApproved.length} action${autoApproved.length === 1 ? "" : "s"} approved for execution this cycle.`
    : "Execution cycle complete — all actions queued for review.";

  const brief = {
    brief_id: randomUUID(),
    generated_at: now,
    daily: {
      headline,
      text: `${run.actions.length} total actions generated across ${run.instantiated_agents.length} active chairs.`,
      next_best_action: "Review the board for pending approvals and cadence briefings."
    },
    weekly: {
      tldr: "Demo cycle complete. System is configured and running in advisor mode.",
      objective_status: { trend: "stable" },
      decisions_needed: run.actions.filter((a) => a.governor_decision === "requires_approval").map((a) => `Approve: ${a.action_type}`)
    }
  };

  const existing = readJson<typeof brief[]>(`briefs/${workspaceId}`, []);
  writeJsonAtomic(`briefs/${workspaceId}`, [...existing, brief].slice(-10));

  appendEvent({
    event_id: randomUUID(),
    org_id: workspaceId,
    event_type: "action_executed",
    actor,
    artifact_type: null,
    artifact_id: null,
    details: { source: "demo", action_count: run.actions.length, brief_headline: headline },
    at: now
  } satisfies GovernanceEvent);

  res.status(201).json({
    status: "demo_ready",
    workspace_id: workspaceId,
    actions: run.actions.length,
    brief_headline: headline,
    chairs_activated: run.instantiated_agents.length,
    auto_approved: run.actions.filter((a) => a.governor_decision === "auto_approved").length,
    requires_approval: run.actions.filter((a) => a.governor_decision === "requires_approval").length,
    brief
  });
});
