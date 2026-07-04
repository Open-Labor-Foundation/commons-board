/**
 * Brief templates — manage scheduled brief templates.
 *
 * The cadence page UI expects templates with:
 *   template_id, name, brief_type, domain, schedule, enabled
 *
 * Built-in templates map: key→template_id, cadence→brief_type.
 * Custom templates store all UI fields directly.
 *
 * Routes:
 *   GET  /api/v1/brief-templates          — list all templates (UI format)
 *   POST /api/v1/brief-templates          — create a custom template
 *   GET  /api/v1/brief-templates/:id      — single template
 *   PUT  /api/v1/brief-templates/:id      — update (enable/disable)
 *   DELETE /api/v1/brief-templates/:id   — delete custom template
 */
import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { requireContext, requireRole } from "../lib/auth.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";

export const briefTemplatesRouter = Router();
briefTemplatesRouter.use(requireContext);

// ── types ─────────────────────────────────────────────────────────────────────

type BriefTemplate = {
  template_id: string;
  name: string;
  brief_type: string;
  domain: string;
  schedule?: string;
  enabled: boolean;
  builtin: boolean;
  created_at: string;
};

// ── built-ins ─────────────────────────────────────────────────────────────────

const BUILTIN_TEMPLATES: BriefTemplate[] = [
  {
    template_id: "exec-weekly-v1",
    name: "Executive Weekly Brief",
    brief_type: "executive",
    domain: "ops",
    schedule: "0 9 * * 1",
    enabled: true,
    builtin: true,
    created_at: "2024-01-01T00:00:00.000Z",
  },
  {
    template_id: "daily-pulse-v1",
    name: "Daily Pulse",
    brief_type: "executive",
    domain: "ops",
    schedule: "0 8 * * *",
    enabled: true,
    builtin: true,
    created_at: "2024-01-01T00:00:00.000Z",
  },
];

function customKey(workspaceId: string): string { return `custom-brief-templates/${workspaceId}`; }

function loadAll(workspaceId: string): BriefTemplate[] {
  const custom = readJson<BriefTemplate[]>(customKey(workspaceId), []);
  return [...BUILTIN_TEMPLATES, ...custom];
}

// ── routes ────────────────────────────────────────────────────────────────────

/** GET /api/v1/brief-templates */
briefTemplatesRouter.get("/", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  res.status(200).json({ templates: loadAll(workspaceId) });
});

/** GET /api/v1/brief-templates/:id */
briefTemplatesRouter.get("/:id", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const template = loadAll(workspaceId).find((t) => t.template_id === req.params.id);
  if (!template) { res.status(404).json({ error: "template not found" }); return; }
  res.status(200).json(template);
});

/** POST /api/v1/brief-templates */
briefTemplatesRouter.post("/", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const body = req.body as Record<string, unknown>;
  const name = String(body.name ?? "").trim();
  if (!name) { res.status(400).json({ error: "name is required" }); return; }

  const template: BriefTemplate = {
    template_id: randomUUID(),
    name,
    brief_type: String(body.brief_type ?? "executive"),
    domain: String(body.domain ?? "ops"),
    schedule: body.schedule ? String(body.schedule) : undefined,
    enabled: body.enabled !== false,
    builtin: false,
    created_at: new Date().toISOString(),
  };

  const existing = readJson<BriefTemplate[]>(customKey(workspaceId), []);
  writeJsonAtomic(customKey(workspaceId), [...existing, template]);
  res.status(201).json(template);
});

/** PUT /api/v1/brief-templates/:id */
briefTemplatesRouter.put("/:id", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const body = req.body as Record<string, unknown>;
  const id = req.params.id;

  const builtin = BUILTIN_TEMPLATES.find((t) => t.template_id === id);
  if (builtin) {
    res.status(400).json({ error: "built-in templates cannot be modified" });
    return;
  }

  const custom = readJson<BriefTemplate[]>(customKey(workspaceId), []);
  const idx = custom.findIndex((t) => t.template_id === id);
  if (idx === -1) { res.status(404).json({ error: "template not found" }); return; }

  custom[idx] = {
    ...custom[idx],
    ...(body.name !== undefined ? { name: String(body.name) } : {}),
    ...(body.brief_type !== undefined ? { brief_type: String(body.brief_type) } : {}),
    ...(body.domain !== undefined ? { domain: String(body.domain) } : {}),
    ...(body.schedule !== undefined ? { schedule: body.schedule ? String(body.schedule) : undefined } : {}),
    ...(body.enabled !== undefined ? { enabled: Boolean(body.enabled) } : {}),
  };
  writeJsonAtomic(customKey(workspaceId), custom);
  res.status(200).json(custom[idx]);
});

/** DELETE /api/v1/brief-templates/:id */
briefTemplatesRouter.delete("/:id", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const id = req.params.id;
  const builtin = BUILTIN_TEMPLATES.find((t) => t.template_id === id);
  if (builtin) { res.status(400).json({ error: "built-in templates cannot be deleted" }); return; }
  const custom = readJson<BriefTemplate[]>(customKey(workspaceId), []);
  const filtered = custom.filter((t) => t.template_id !== id);
  if (filtered.length === custom.length) { res.status(404).json({ error: "template not found" }); return; }
  writeJsonAtomic(customKey(workspaceId), filtered);
  res.status(200).json({ deleted: id });
});
