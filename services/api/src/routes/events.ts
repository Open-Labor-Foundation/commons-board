/**
 * Events route — governance event stream from the decision log.
 *
 * Ported from mother-board routes/events.ts (38 LOC).
 * Sanitized: store.listProductEvents() → getLog() from decision-log.ts.
 *
 * Routes:
 *   GET /api/v1/events — governance event stream (newest first, paginated)
 */
import { Router, type Request, type Response } from "express";
import { requireContext } from "../lib/auth.js";
import { getLog } from "../lib/decision-log.js";

export const eventsRouter = Router();
eventsRouter.use(requireContext);

/** GET /api/v1/events */
eventsRouter.get("/", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const log = getLog(workspaceId);
  const eventType = req.query.event_type as string | undefined;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  const offset = Math.max(0, Number(req.query.offset ?? 0));

  const filtered = eventType ? log.filter((e) => e.event.event_type === eventType) : log;
  const reversed = filtered.slice().reverse();
  const page = reversed.slice(offset, offset + limit);

  res.status(200).json({
    events: page.map((entry) => ({
      entry_id: entry.entry_id,
      sequence: entry.sequence,
      event_type: entry.event.event_type,
      actor: entry.event.actor,
      artifact_type: entry.event.artifact_type,
      artifact_id: entry.event.artifact_id,
      details: entry.event.details,
      at: entry.at
    })),
    total: filtered.length,
    offset,
    limit
  });
});
