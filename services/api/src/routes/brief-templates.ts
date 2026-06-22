/**
 * Brief templates — list and get brief template metadata.
 *
 * Ported from mother-board routes/brief-templates.ts (38 LOC).
 * No sanitization needed — pure metadata, no org-specific content.
 */
import { Router, type Request, type Response } from "express";
import { requireContext } from "../lib/auth.js";

export const briefTemplatesRouter = Router();
briefTemplatesRouter.use(requireContext);

const TEMPLATES = [
  {
    key: "exec-weekly-v1",
    name: "Executive Weekly Brief",
    description: "Full weekly board brief with objective status, recommended plan, and watchlist.",
    version: "1.0.0",
    cadence: "weekly"
  },
  {
    key: "daily-pulse-v1",
    name: "Daily Pulse",
    description: "Lightweight daily headline, anomaly signal, and next best action.",
    version: "1.0.0",
    cadence: "daily"
  }
];

/** GET /api/v1/brief-templates */
briefTemplatesRouter.get("/", (_req: Request, res: Response) => {
  res.status(200).json({ templates: TEMPLATES });
});

/** GET /api/v1/brief-templates/:key */
briefTemplatesRouter.get("/:key", (req: Request, res: Response) => {
  const template = TEMPLATES.find((t) => t.key === req.params.key);
  if (!template) {
    res.status(404).json({ error: "template not found" });
    return;
  }
  res.status(200).json(template);
});
