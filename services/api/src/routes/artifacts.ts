/**
 * Artifact CRUD routes. Every write is schema-validated and governance-event-first
 * (signed + hash-chained decision log entry written before the artifact persists).
 *
 * Routes:
 *   GET    /api/v1/artifacts/:type/latest     — latest version
 *   GET    /api/v1/artifacts/:type            — version list (oldest first)
 *   GET    /api/v1/artifacts/:type/:version   — specific version
 *   POST   /api/v1/artifacts/:type            — write new version (admin/operator)
 */
import { Router, type Request, type Response } from "express";
import type { ArtifactType } from "@commons-board/shared";
import { writeArtifact, getArtifact, getArtifactHistory, ArtifactValidationError } from "../lib/artifact-store.js";
import { requireContext, requireRole } from "../lib/auth.js";
import { getAddinArtifactTypes } from "../lib/addin-registry.js";
import { asyncHandler } from "../lib/async-handler.js";

export const artifactsRouter = Router();

const BASE_ARTIFACT_TYPES: string[] = [
  "business_profile",
  "objective_config",
  "autonomy_policy",
  "cadence_protocol",
  "agent_blueprint",
  "collective_config",
];

function parseType(raw: string): ArtifactType | null {
  const all = [...BASE_ARTIFACT_TYPES, ...getAddinArtifactTypes()];
  // Cast is intentional: add-in types extend the runtime-valid set beyond the static union.
  return all.includes(raw) ? (raw as ArtifactType) : null;
}

artifactsRouter.use(requireContext);

/** GET /api/v1/artifacts/:type/latest */
artifactsRouter.get("/:type/latest", asyncHandler(async (req: Request, res: Response) => {
  const type = parseType(req.params.type);
  if (!type) {
    res.status(400).json({ error: "unsupported artifact type" });
    return;
  }
  const record = await getArtifact(req.ctx!.workspaceId, type);
  if (!record) {
    res.status(404).json({ error: "artifact not found" });
    return;
  }
  res.status(200).json(record);
}));

/** GET /api/v1/artifacts/:type */
artifactsRouter.get("/:type", asyncHandler(async (req: Request, res: Response) => {
  const type = parseType(req.params.type);
  if (!type) {
    res.status(400).json({ error: "unsupported artifact type" });
    return;
  }
  const history = await getArtifactHistory(req.ctx!.workspaceId, type);
  res.status(200).json({ type, versions: history.map((r) => ({ artifact_id: r.artifact_id, version: r.version, created_at: r.created_at })) });
}));

/** GET /api/v1/artifacts/:type/:version */
artifactsRouter.get("/:type/:version", asyncHandler(async (req: Request, res: Response) => {
  const type = parseType(req.params.type);
  if (!type) {
    res.status(400).json({ error: "unsupported artifact type" });
    return;
  }
  const ver = Number(req.params.version);
  if (!Number.isInteger(ver) || ver < 1) {
    res.status(400).json({ error: "version must be a positive integer" });
    return;
  }
  const history = await getArtifactHistory(req.ctx!.workspaceId, type);
  const record = history.find((r) => r.version === ver);
  if (!record) {
    res.status(404).json({ error: "artifact not found" });
    return;
  }
  res.status(200).json(record);
}));

/** POST /api/v1/artifacts/:type */
artifactsRouter.post("/:type", requireRole(["admin", "operator"]), asyncHandler(async (req: Request, res: Response) => {
  const type = parseType(req.params.type);
  if (!type) {
    res.status(400).json({ error: "unsupported artifact type" });
    return;
  }
  const payload = (req.body as { payload?: unknown })?.payload ?? req.body;
  try {
    const record = await writeArtifact(req.ctx!.workspaceId, type, payload, req.ctx!.userId);
    res.status(201).json(record);
  } catch (err) {
    if (err instanceof ArtifactValidationError) {
      res.status(422).json({ error: "artifact validation failed", details: err.errors });
      return;
    }
    throw err;
  }
}));
