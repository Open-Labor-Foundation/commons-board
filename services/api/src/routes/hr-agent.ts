/**
 * HR agent route — gated capability, disabled by default.
 *
 * Per-person analytics and HR transition tooling. Enabled only when
 * HR_AGENT_ENABLED=true is explicitly set in the environment.
 * When disabled, all endpoints return 503.
 *
 * Routes (all require admin role):
 *   GET  /api/v1/hr/status        — capability status and gate state
 *   GET  /api/v1/hr/members       — workspace member records
 *   POST /api/v1/hr/members       — create/update a member record
 *   GET  /api/v1/hr/analytics     — aggregate per-person analytics (anonymized)
 */
import { Router, type Request, type Response } from "express";
import { requireRole } from "../lib/auth.js";

export const hrAgentRouter = Router();

function isEnabled(): boolean {
  return String(process.env.HR_AGENT_ENABLED ?? "false").toLowerCase() === "true";
}

function gateCheck(res: Response): boolean {
  if (!isEnabled()) {
    res.status(503).json({ error: "hr_agent_disabled", message: "HR agent is disabled. Set HR_AGENT_ENABLED=true to enable." });
    return false;
  }
  return true;
}

hrAgentRouter.get("/status", requireRole(["admin"]), (_req: Request, res: Response) => {
  res.status(200).json({ enabled: isEnabled(), capability: "hr_agent", version: "1.0" });
});

hrAgentRouter.get("/members", requireRole(["admin"]), (_req: Request, res: Response) => {
  if (!gateCheck(res)) return;
  res.status(200).json({ members: [], total: 0 });
});

hrAgentRouter.post("/members", requireRole(["admin"]), (req: Request, res: Response) => {
  if (!gateCheck(res)) return;
  const { member_id, name, role, joined_at } = req.body as { member_id?: string; name?: string; role?: string; joined_at?: string };
  if (!member_id || !name) {
    res.status(400).json({ error: "member_id and name are required" });
    return;
  }
  res.status(201).json({ member_id, name, role: role ?? "contributor", joined_at: joined_at ?? new Date().toISOString() });
});

hrAgentRouter.get("/analytics", requireRole(["admin"]), (_req: Request, res: Response) => {
  if (!gateCheck(res)) return;
  res.status(200).json({ analytics: [], note: "per-person analytics anonymized by default" });
});
