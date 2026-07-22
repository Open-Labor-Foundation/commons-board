/**
 * Decision log routes — read-only access to the append-only, hash-chained audit log.
 *
 * Routes:
 *   GET  /api/v1/decision-log           — paginated log entries
 *   GET  /api/v1/decision-log/verify    — verify chain integrity
 */
import { Router, type Request, type Response } from "express";
import { requireContext } from "../lib/auth.js";
import { getLog, verifyLog } from "../lib/decision-log.js";
import { asyncHandler } from "../lib/async-handler.js";

export const decisionLogRouter = Router();
decisionLogRouter.use(requireContext);

/** GET /api/v1/decision-log */
decisionLogRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10)));
  const eventType = req.query.event_type as string | undefined;

  let entries = await getLog(orgId);
  if (eventType) entries = entries.filter((e) => e.event.event_type === eventType);

  const total = entries.length;
  // Return newest first
  const reversed = [...entries].reverse();
  const page_entries = reversed.slice((page - 1) * limit, page * limit);

  res.status(200).json({
    entries: page_entries,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  });
}));

/** GET /api/v1/decision-log/verify */
decisionLogRouter.get("/verify", asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const result = await verifyLog(orgId);
  res.status(200).json(result);
}));
