/**
 * Observability routes — system health, run history, bottleneck analysis.
 *
 * Ported from mother-board routes/observability.ts.
 * Sanitized:
 *   - store.* → readJson() from persistence.ts
 *   - DB connector run queries removed (Phase 15 connectors)
 *   - AEB_TRACE_ARCHIVE_PATH → CB_TRACE_ARCHIVE_PATH
 *   - Removed dead-letter / exception-triage patterns
 *   - Removed cross-tenant block tracking (not applicable in OLF)
 *   - loopBottlenecks wired to execution run records
 *
 * Routes:
 *   GET /api/v1/obs/execution-runs     — execution run history
 *   GET /api/v1/obs/last-cadence       — last cadence run
 *   GET /api/v1/obs/bottlenecks        — operational loop bottleneck analysis
 *   GET /api/v1/obs/error-counts       — error summary
 *   GET /api/v1/obs/connector-health   — connector health (stub; Phase 15)
 */
import { Router, type Request, type Response } from "express";
import { requireContext } from "../lib/auth.js";
import { readJson } from "../lib/persistence.js";
import { loopBottlenecks } from "../lib/operational-loop.js";
import { getLog } from "../lib/decision-log.js";

export const observabilityRouter = Router();
observabilityRouter.use(requireContext);

/** GET /api/v1/obs/execution-runs */
observabilityRouter.get("/execution-runs", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const runs = readJson<unknown[]>(`execution-runs/${workspaceId}`, []);
  res.status(200).json({ runs: runs.slice().reverse(), total: runs.length });
});

/** GET /api/v1/obs/last-cadence */
observabilityRouter.get("/last-cadence", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const state = readJson<Record<string, string>>(`cadence-state/${workspaceId}`, {});
  res.status(200).json({ last_daily_at: state.last_daily_at ?? null, last_weekly_at: state.last_weekly_at ?? null, last_monthly_at: state.last_monthly_at ?? null });
});

/** GET /api/v1/obs/bottlenecks */
observabilityRouter.get("/bottlenecks", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const requests = readJson<Array<{ status: string; target_domain?: string }>>(
    `board-requests/${workspaceId}`,
    []
  );
  const events = requests.map((r) => ({ stage: r.status, status: r.status }));
  const bottlenecks = loopBottlenecks(events);
  res.status(200).json({ bottlenecks, request_count: requests.length });
});

/** GET /api/v1/obs/error-counts */
observabilityRouter.get("/error-counts", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const execRuns = readJson<Array<{ status: string }>>(
    `execution-runs/${workspaceId}`,
    []
  );
  const decisionLog = getLog(workspaceId);
  const approvals = readJson<Array<{ status: string }>>(`approval-records/${workspaceId}`, []);
  const failedRuns = execRuns.filter((r) => r.status === "failed").length;
  const rejectedApprovals = approvals.filter((a) => a.status === "rejected").length;
  res.status(200).json({
    failed_execution_runs: failedRuns,
    rejected_approvals: rejectedApprovals,
    decision_log_entries: decisionLog.length,
    governance_error_rate: Number((failedRuns / Math.max(1, execRuns.length)).toFixed(3))
  });
});

/** GET /api/v1/obs/connector-health — stub until Phase 15 connectors */
observabilityRouter.get("/connector-health", (_req: Request, res: Response) => {
  res.status(200).json({
    health: { slack: "not_configured", email: "not_configured", webhook: "not_configured" },
    note: "connector integrations available in Phase 15"
  });
});
