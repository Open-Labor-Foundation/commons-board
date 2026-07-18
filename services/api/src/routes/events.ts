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
import { asyncHandler } from "../lib/async-handler.js";

export const eventsRouter = Router();
eventsRouter.use(requireContext);

/** GET /api/v1/events */
eventsRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const log = await getLog(workspaceId);
  const eventType = req.query.event_type as string | undefined;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  const offset = Math.max(0, Number(req.query.offset ?? 0));

  const filtered = eventType ? log.filter((e) => e.event.event_type === eventType) : log;
  const reversed = filtered.slice().reverse();
  const page = reversed.slice(offset, offset + limit);

  res.status(200).json({
    events: page.map((entry) => {
      const et = entry.event.event_type;
      const d = entry.event.details ?? {};
      const summaryText = (() => {
        switch (et as string) {
          case "artifact_written": return `Updated ${String(d.artifact_type ?? d.type ?? "artifact").replace(/_/g, " ")}`;
          case "artifact_created": return `Created ${String(d.artifact_type ?? d.type ?? "artifact").replace(/_/g, " ")}`;
          case "action_proposed": return String(d.summary ?? d.action_type ?? "Action proposed");
          case "action_executed": return String(d.summary ?? d.action_type ?? "Action executed");
          case "approval_recorded": return `Approval ${String(d.decision ?? "recorded")} for ${String(d.action_id ?? "action")}`;
          case "board_request_submitted": return `Board request submitted`;
          case "board_request_status_changed": return `Board request ${String(d.status ?? "updated")}`;
          case "board_chat_completed": return `Board chat answered`;
          case "cadence_run": return `Cadence run completed`;
          default: return et.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        }
      })();
      return {
        entry_id: entry.entry_id,
        event_id: entry.event.event_id ?? entry.entry_id,
        sequence: entry.sequence,
        event_type: et,
        type: et,
        actor: entry.event.actor,
        artifact_type: entry.event.artifact_type,
        artifact_id: entry.event.artifact_id,
        details: d,
        at: entry.at,
        created_at: entry.at,
        summary: summaryText,
        domain: (d.domain as string | undefined) ?? (d.target_domain as string | undefined) ?? undefined,
      };
    }),
    total: filtered.length,
    offset,
    limit
  });
}));
