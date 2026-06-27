/**
 * Brief templates — list and get brief template metadata.
 *
 * Ported from mother-board routes/brief-templates.ts (38 LOC).
 * No sanitization needed — pure metadata, no org-specific content.
 */
import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { requireContext, requireRole } from "../lib/auth.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";

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
briefTemplatesRouter.get("/", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const custom = readJson<CustomTemplate[]>(customKey(workspaceId), []);
  res.status(200).json({ templates: [...TEMPLATES, ...custom] });
});

/** GET /api/v1/brief-templates/:key */
briefTemplatesRouter.get("/:key", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const custom = readJson<CustomTemplate[]>(customKey(workspaceId), []);
  const template = [...TEMPLATES, ...custom].find((t) => t.key === req.params.key);
  if (!template) {
    res.status(404).json({ error: "template not found" });
    return;
  }
  res.status(200).json(template);
});

type CustomTemplate = {
  key: string;
  name: string;
  description: string;
  version: string;
  cadence: "daily" | "weekly" | "monthly";
  created_at: string;
  created_by: string;
  workspace_id: string;
};

function customKey(workspaceId: string): string { return `custom-brief-templates/${workspaceId}`; }

/** POST /api/v1/brief-templates */
briefTemplatesRouter.post("/", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;

  const key = String(req.body?.key ?? "").trim();
  const name = String(req.body?.name ?? "").trim();
  const description = String(req.body?.description ?? "").trim();
  const cadence = String(req.body?.cadence ?? "").trim();

  if (!key) { res.status(400).json({ error: "key is required" }); return; }
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  if (cadence !== "daily" && cadence !== "weekly" && cadence !== "monthly") {
    res.status(400).json({ error: "cadence must be daily|weekly|monthly" }); return;
  }
  if (TEMPLATES.find((t) => t.key === key)) {
    res.status(409).json({ error: "key conflicts with a built-in template" }); return;
  }

  const existing = readJson<CustomTemplate[]>(customKey(workspaceId), []);
  if (existing.find((t) => t.key === key)) {
    res.status(409).json({ error: "template key already exists" }); return;
  }

  const template: CustomTemplate = {
    key,
    name,
    description,
    version: `${randomUUID().slice(0, 8)}`,
    cadence: cadence as CustomTemplate["cadence"],
    created_at: new Date().toISOString(),
    created_by: userId,
    workspace_id: workspaceId,
  };

  writeJsonAtomic(customKey(workspaceId), [...existing, template]);
  res.status(201).json(template);
});
