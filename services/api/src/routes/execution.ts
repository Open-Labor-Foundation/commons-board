/**
 * Execution routes — governed action runtime trigger and status.
 *
 * Ported from mother-board routes/execution.ts.
 * Sanitized:
 *   - Removed store.* patterns → getArtifact() + appendEvent() + persistence.ts
 *   - Removed platform billing plan checks (no OLF platform charge)
 *   - Removed store.createProductEvent() telemetry (Phase 7)
 *   - Removed store.createAgentRun() (Phase 7)
 *   - Removed store.enforceRecommendationThrottle() (Phase 7)
 *   - Removed processDeadLetterException (org-specific, not carried)
 *   - Added SIM/LIVE mode awareness from simulation-board state
 *   - Added CB_KILL_SWITCH env gate
 *
 * Governance invariant: execution log entries write to decision log BEFORE results
 * are returned. SIM mode produces an identical governance trail with no external writes.
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { ArtifactType, GovernanceEvent } from "@commons-board/shared";
import { requireContext, requireRole } from "../lib/auth.js";
import { getArtifact } from "../lib/artifact-store.js";
import { appendEvent } from "../lib/decision-log.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";
import { runAgentExecution } from "../agent-runtime/execution/engine.js";
import { buildLoopCheckpoints } from "../lib/operational-loop.js";
import { classifyAction } from "../lib/verification-policy.js";
import type { ArtifactsForExecution, GovernedAction } from "../agent-runtime/execution/types.js";

export const executionRouter = Router();
executionRouter.use(requireContext);

type ExecutionRunRecord = {
  run_id: string;
  workspace_id: string;
  initiated_by: string;
  sim_mode: boolean;
  status: "pending" | "completed" | "failed";
  action_count: number;
  blocked_count: number;
  approval_count: number;
  auto_count: number;
  loop_checkpoints: ReturnType<typeof buildLoopCheckpoints>;
  initiated_at: string;
  completed_at?: string;
};

function runsKey(workspaceId: string): string {
  return `execution-runs/${workspaceId}`;
}

function isKillSwitchEnabled(): boolean {
  return process.env.CB_KILL_SWITCH === "true";
}

function isSimMode(workspaceId: string): boolean {
  const simRecord = readJson<{ mode?: string }>(
    `sim-mode/${workspaceId}`,
    { mode: "live" }
  );
  return simRecord.mode === "sim";
}

function loadArtifacts(workspaceId: string): { artifacts: ArtifactsForExecution | null; missing: string[] } {
  const businessProfile = getArtifact(workspaceId, "business_profile");
  const objectiveConfig = getArtifact(workspaceId, "objective_config");
  const autonomyPolicy = getArtifact(workspaceId, "autonomy_policy");
  const cadenceProtocol = getArtifact(workspaceId, "cadence_protocol");
  const agentBlueprint = getArtifact(workspaceId, "agent_blueprint");

  const missing: string[] = [];
  if (!businessProfile) missing.push("business_profile");
  if (!objectiveConfig) missing.push("objective_config");
  if (!autonomyPolicy) missing.push("autonomy_policy");
  if (!cadenceProtocol) missing.push("cadence_protocol");
  if (!agentBlueprint) missing.push("agent_blueprint");

  if (missing.length > 0) return { artifacts: null, missing };

  const financialPolicy = getArtifact(workspaceId, "financial_policy");

  return {
    missing: [],
    artifacts: {
      business_profile: businessProfile!.payload as Record<string, unknown>,
      objective_config: objectiveConfig!.payload as Record<string, unknown>,
      autonomy_policy: autonomyPolicy!.payload as ArtifactsForExecution["autonomy_policy"],
      cadence_protocol: cadenceProtocol!.payload as Record<string, unknown>,
      agent_blueprint: agentBlueprint!.payload as ArtifactsForExecution["agent_blueprint"],
      ...(financialPolicy ? { financial_policy: financialPolicy.payload as ArtifactsForExecution["financial_policy"] } : {})
    }
  };
}

/** POST /api/v1/execution/run */
executionRouter.post("/run", requireRole(["admin", "operator"]), async (req: Request, res: Response) => {
  const ctx = req.ctx!;

  if (isKillSwitchEnabled()) {
    res.status(423).json({ error: "workspace kill switch enabled" });
    return;
  }

  const sim = isSimMode(ctx.workspaceId);
  const { artifacts, missing } = loadArtifacts(ctx.workspaceId);

  if (!artifacts) {
    res.status(400).json({ error: "missing required artifacts; complete interview before execution", missing });
    return;
  }

  const now = new Date().toISOString();
  const runId = randomUUID();

  let runResult: ReturnType<typeof runAgentExecution>;
  try {
    runResult = runAgentExecution(artifacts);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown error";
    res.status(500).json({ error: "execution run failed", detail });
    return;
  }

  // Governance: write every action decision to the immutable decision log before returning results.
  for (const action of runResult.actions) {
    const { route, required_approvers, risk_score } = classifyAction(
      {
        action_id: `${action.agent_id}:${action.action_type}`,
        org_id: ctx.workspaceId,
        agent_id: action.agent_id,
        action_type: action.action_type,
        summary: `${action.action_type} from ${action.agent_id}`,
        evidence: action.evidence,
        assumptions: action.assumptions,
        risk_score: action.risk_score,
        impact_range: String(action.impact_range.p50),
        blast_radius: action.blast_radius.level,
        approvals_required: action.approvals_required,
        rollback_plan: JSON.stringify(action.rollback_plan),
        governor_decision: action.governor_decision === "auto_approved" ? "auto_approved" : action.governor_decision === "blocked" ? "blocked" : "requires_approval",
        created_at: now
      },
      "business"
    );

    appendEvent({
      event_id: randomUUID(),
      org_id: ctx.workspaceId,
      event_type: action.governor_decision === "blocked" ? "action_proposed" : "action_executed",
      actor: action.agent_id,
      artifact_type: null,
      artifact_id: null,
      details: {
        run_id: runId,
        sim_mode: sim,
        action_type: action.action_type,
        governor_decision: action.governor_decision,
        risk_score,
        route,
        required_approvers,
        governor_reasons: action.governor_reasons
      },
      at: now
    } satisfies GovernanceEvent);
  }

  // Build loop checkpoints for the overall run.
  const hasApprovalRequired = runResult.actions.some((a: GovernedAction) => a.governor_decision === "requires_approval");
  const loopCheckpoints = buildLoopCheckpoints({
    requestId: runId,
    approvalRequired: hasApprovalRequired,
    context: { sim_mode: sim, action_count: runResult.actions.length }
  });

  const runRecord: ExecutionRunRecord = {
    run_id: runId,
    workspace_id: ctx.workspaceId,
    initiated_by: ctx.userId,
    sim_mode: sim,
    status: "completed",
    action_count: runResult.actions.length,
    blocked_count: runResult.actions.filter((a: GovernedAction) => a.governor_decision === "blocked").length,
    approval_count: runResult.actions.filter((a: GovernedAction) => a.governor_decision === "requires_approval").length,
    auto_count: runResult.actions.filter((a: GovernedAction) => a.governor_decision === "auto_approved").length,
    loop_checkpoints: loopCheckpoints,
    initiated_at: now,
    completed_at: new Date().toISOString()
  };

  const existing = readJson<ExecutionRunRecord[]>(runsKey(ctx.workspaceId), []);
  writeJsonAtomic(runsKey(ctx.workspaceId), [...existing, runRecord]);

  res.status(200).json({
    run_id: runId,
    sim_mode: sim,
    instantiated_agents: runResult.instantiated_agents,
    actions: runResult.actions,
    department_rollups: runResult.department_rollups ?? [],
    execution_log_count: runResult.execution_log.length,
    loop_checkpoints: loopCheckpoints,
    summary: {
      total: runRecord.action_count,
      blocked: runRecord.blocked_count,
      requires_approval: runRecord.approval_count,
      auto_approved: runRecord.auto_count
    }
  });
});

/** GET /api/v1/execution/runs */
executionRouter.get("/runs", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const runs = readJson<ExecutionRunRecord[]>(runsKey(workspaceId), []);
  res.status(200).json({ runs: runs.slice().reverse(), total: runs.length });
});

/** GET /api/v1/execution/runs/:run_id */
executionRouter.get("/runs/:run_id", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const runs = readJson<ExecutionRunRecord[]>(runsKey(workspaceId), []);
  const run = runs.find((r) => r.run_id === req.params.run_id);
  if (!run) {
    res.status(404).json({ error: "execution run not found" });
    return;
  }
  res.status(200).json({ run });
});

/** POST /api/v1/execution/child-runtimes */
executionRouter.post("/child-runtimes", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const ctx = req.ctx!;
  const body = req.body as { child_id: string; child_workspace_id: string; name: string; api_base_url?: string };
  if (!body.child_id || !body.child_workspace_id || !body.name) {
    res.status(400).json({ error: "child_id, child_workspace_id, and name are required" });
    return;
  }
  const now = new Date().toISOString();
  const childKey = `child-runtimes/${ctx.workspaceId}`;
  const existing = readJson<Array<typeof body & { registered_at: string }>>(childKey, []);
  const updated = [...existing.filter((c) => c.child_id !== body.child_id), { ...body, registered_at: now }];
  writeJsonAtomic(childKey, updated);

  appendEvent({
    event_id: randomUUID(),
    org_id: ctx.workspaceId,
    event_type: "federation_linked" as const,
    actor: ctx.userId,
    artifact_type: null,
    artifact_id: null,
    details: { child_id: body.child_id, child_workspace_id: body.child_workspace_id, name: body.name },
    at: now
  } satisfies GovernanceEvent);

  res.status(201).json({ child_id: body.child_id, child_workspace_id: body.child_workspace_id, registered_at: now });
});

/** GET /api/v1/execution/child-runtimes */
executionRouter.get("/child-runtimes", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const childKey = `child-runtimes/${workspaceId}`;
  const children = readJson<unknown[]>(childKey, []);
  res.status(200).json({ children, total: children.length });
});
