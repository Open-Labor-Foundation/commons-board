/**
 * Feedback route — captures user thumbs-up/down on board outputs.
 *
 * Ported from mother-board routes/feedback.ts.
 * Sanitized: store.createProductEvent() → appendEvent() via decision-log.
 * GovernanceEventType extended with "user_feedback".
 *
 * Routes:
 *   POST /api/v1/feedback         — record a feedback event
 *   GET  /api/v1/feedback/summary — aggregate helpful/not-helpful counts
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { requireContext } from "../lib/auth.js";
import { appendEvent, getLog } from "../lib/decision-log.js";
import { asyncHandler } from "../lib/async-handler.js";

export const feedbackRouter = Router();
feedbackRouter.use(requireContext);

feedbackRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const { targetType, targetId, helpful, reason, note } = req.body as {
    targetType?: "brief" | "action";
    targetId?: string;
    helpful?: boolean;
    reason?: string;
    note?: string;
  };

  if (!targetType || !targetId || typeof helpful !== "boolean") {
    res.status(400).json({ error: "targetType, targetId, and helpful are required" });
    return;
  }

  const entry = await appendEvent({
    event_id: randomUUID(),
    org_id: workspaceId,
    event_type: "user_feedback" as never,
    actor: userId,
    artifact_type: null,
    artifact_id: targetId,
    details: { targetType, helpful, reason: reason ?? null, note: note ?? null },
    at: new Date().toISOString()
  });

  res.status(201).json({ entry_id: entry.entry_id, recorded: true });
}));

feedbackRouter.get("/summary", asyncHandler(async (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const log = await getLog(workspaceId);
  const feedbackEntries = log.filter((e) => (e.event.event_type as string) === "user_feedback");
  const helpful = feedbackEntries.filter((e) => e.event.details.helpful === true).length;
  const notHelpful = feedbackEntries.filter((e) => e.event.details.helpful === false).length;
  res.status(200).json({
    helpful,
    notHelpful,
    total: feedbackEntries.length,
    reasons: feedbackEntries.map((e) => e.event.details.reason ?? "unspecified")
  });
}));
