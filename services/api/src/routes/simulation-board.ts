/**
 * Simulation board — SIM/LIVE mode toggle and status.
 *
 * SIM mode lets the board operate against test data and synthetic org blueprints
 * without touching any live org state. LIVE mode is the default.
 *
 * Routes:
 *   GET  /api/v1/sim/status      — get current SIM/LIVE mode
 *   POST /api/v1/sim/activate    — switch to SIM mode
 *   POST /api/v1/sim/deactivate  — switch back to LIVE mode
 *
 * Sanitized from mother-board: no org-specific SIM scenarios (grant-pipeline,
 * loan-packet) — those were pre-OLF content not carried forward.
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { GovernanceEvent } from "@commons-board/shared";
import { requireContext, requireRole } from "../lib/auth.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";
import { appendEvent } from "../lib/decision-log.js";

export const simulationBoardRouter = Router();
simulationBoardRouter.use(requireContext);

type SimModeRecord = {
  mode: "sim" | "live";
  activated_by?: string;
  activated_at?: string;
  note?: string;
};

function simKey(orgId: string): string {
  return `sim-mode/${orgId}`;
}

/** GET /api/v1/sim/status */
simulationBoardRouter.get("/status", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const record = readJson<SimModeRecord>(simKey(workspaceId), { mode: "live" });
  res.status(200).json(record);
});

/** POST /api/v1/sim/activate */
simulationBoardRouter.post("/activate", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const ctx = req.ctx!;
  const { note } = req.body as { note?: string };
  const now = new Date().toISOString();

  const record: SimModeRecord = {
    mode: "sim",
    activated_by: ctx.userId,
    activated_at: now,
    note: note?.trim()
  };
  writeJsonAtomic(simKey(ctx.workspaceId), record);

  appendEvent({
    event_id: randomUUID(),
    org_id: ctx.workspaceId,
    event_type: "autonomy_mode_changed",
    actor: ctx.userId,
    artifact_type: null,
    artifact_id: null,
    details: { mode: "sim", previous_mode: "live", note: note ?? "" },
    at: now
  } satisfies GovernanceEvent);

  res.status(200).json(record);
});

/** POST /api/v1/sim/deactivate */
simulationBoardRouter.post("/deactivate", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const ctx = req.ctx!;
  const now = new Date().toISOString();

  const record: SimModeRecord = { mode: "live" };
  writeJsonAtomic(simKey(ctx.workspaceId), record);

  appendEvent({
    event_id: randomUUID(),
    org_id: ctx.workspaceId,
    event_type: "autonomy_mode_changed",
    actor: ctx.userId,
    artifact_type: null,
    artifact_id: null,
    details: { mode: "live", previous_mode: "sim" },
    at: now
  } satisfies GovernanceEvent);

  res.status(200).json(record);
});
