/**
 * Cadence routes — trigger and manage the board's operating cadence.
 *
 * Routes:
 *   POST /api/v1/cadence/run    — trigger a cadence run (daily + weekly)
 *   GET  /api/v1/cadence/status — get cadence state
 *   GET  /api/v1/cadence/brief  — get latest brief
 *
 * Sanitized from mother-board routes/cadence.ts:
 *   - Removed store.* / DB lock / idempotency patterns
 *   - Removed SlackConnector delivery (Phase 15)
 *   - Delivery target is log-to-persistence only
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { GovernanceEvent } from "@commons-board/shared";
import { requireContext, requireRole } from "../lib/auth.js";
import { getArtifact } from "../lib/artifact-store.js";
import { appendEvent } from "../lib/decision-log.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";
import { runAgentExecution } from "../agent-runtime/execution/engine.js";
import { buildDailyPulse, buildWeeklyBrief } from "../workers/cadence.js";
import { recordCadenceRun, getCadenceState } from "../workers/scheduler.js";
import type { ArtifactsForExecution } from "../agent-runtime/execution/types.js";
import { normalizeAutonomyPolicy, normalizeAgentBlueprint, normalizeObjectiveConfig } from "../lib/artifact-normalize.js";

export const cadenceRouter = Router();
cadenceRouter.use(requireContext);

function briefKey(orgId: string): string {
  return `cadence-briefs/${orgId}`;
}

function isKillSwitchEnabled(): boolean {
  return process.env.CB_KILL_SWITCH === "true";
}

/** POST /api/v1/cadence/run */
cadenceRouter.post("/run", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const ctx = req.ctx!;

  if (isKillSwitchEnabled()) {
    res.status(423).json({ error: "workspace kill switch enabled" });
    return;
  }

  const bp = getArtifact(ctx.workspaceId, "business_profile");
  const oc = getArtifact(ctx.workspaceId, "objective_config");
  const ap = getArtifact(ctx.workspaceId, "autonomy_policy");
  const cp = getArtifact(ctx.workspaceId, "cadence_protocol");
  const ab = getArtifact(ctx.workspaceId, "agent_blueprint");

  if (!bp || !oc || !ap || !cp || !ab) {
    res.status(400).json({ error: "missing required artifacts; complete interview before running cadence" });
    return;
  }

  let runResult: ReturnType<typeof runAgentExecution>;
  try {
    runResult = runAgentExecution({
      business_profile: bp.payload as Record<string, unknown>,
      objective_config: normalizeObjectiveConfig(oc.payload as Record<string, unknown>),
      autonomy_policy:  normalizeAutonomyPolicy(ap.payload as Record<string, unknown>),
      cadence_protocol: cp.payload as Record<string, unknown>,
      agent_blueprint:  normalizeAgentBlueprint(ab.payload as Record<string, unknown>)
    });
  } catch (err) {
    res.status(500).json({ error: "execution failed", detail: err instanceof Error ? err.message : "unknown" });
    return;
  }

  const daily = buildDailyPulse(runResult.actions);
  const weekly = buildWeeklyBrief(runResult.actions, { correlationId: req.correlationId });
  const now = new Date().toISOString();

  const existing = readJson<Array<{ generated_at: string; daily: typeof daily; weekly: typeof weekly }>>(briefKey(ctx.workspaceId), []);
  writeJsonAtomic(briefKey(ctx.workspaceId), [...existing, { generated_at: now, daily, weekly }].slice(-10));

  recordCadenceRun(ctx.workspaceId, "daily");
  recordCadenceRun(ctx.workspaceId, "weekly");

  appendEvent({
    event_id: randomUUID(),
    org_id: ctx.workspaceId,
    event_type: "action_executed",
    actor: ctx.userId,
    artifact_type: null,
    artifact_id: null,
    details: { cadence_run: true, action_count: runResult.actions.length, brief_trend: weekly.objective_status.trend },
    at: now
  } satisfies GovernanceEvent);

  res.status(200).json({
    generated_at: now,
    daily,
    weekly,
    delivery: { ok: true, channel: "persistence", attempts: 1 }
  });
});

/** GET /api/v1/cadence/status */
cadenceRouter.get("/status", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const state = getCadenceState(workspaceId);
  res.status(200).json({ state });
});

/** GET /api/v1/cadence/brief */
cadenceRouter.get("/brief", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const all = readJson<Array<{ generated_at: string; daily: unknown; weekly: unknown }>>(briefKey(workspaceId), []);
  if (all.length === 0) {
    res.status(404).json({ error: "no brief generated yet; run POST /api/v1/cadence/run" });
    return;
  }
  res.status(200).json(all[all.length - 1]);
});
