/**
 * Org routes — specialist resolution, chair staffing, and catalog gap management.
 *
 * Routes:
 *   POST /api/v1/org/resolve-specialists         — resolve all chairs in agent_blueprint
 *   GET  /api/v1/org/specialist-matches          — get pending resolutions
 *   POST /api/v1/org/confirm-specialists         — confirm and write to agent_blueprint
 *   PUT  /api/v1/org/chairs/:chair_id/specialists — override a chair's specialists
 *   POST /api/v1/org/gaps/:gap_id/submit         — mark gap submitted to labor-commons
 *   GET  /api/v1/org/gaps                        — list catalog gaps
 *   GET  /api/v1/org/catalog-sync               — run catalog sync check
 */
import { Router, type Request, type Response } from "express";
import type { ArtifactType } from "@commons-board/shared";
import { getArtifact, writeArtifact, ArtifactValidationError } from "../lib/artifact-store.js";
import { requireContext, requireRole } from "../lib/auth.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";
import { resolveAllChairs, applyResolutionsToBlueprint, type BlueprintResolution } from "../services/specialist-resolver.js";
import { loadGaps, updateGap } from "../lib/labor-commons-client.js";
import { runCatalogSync } from "../workers/catalog-sync.js";

export const orgRouter = Router();

orgRouter.use(requireContext);

/** POST /api/v1/org/resolve-specialists */
orgRouter.post("/resolve-specialists", requireRole(["admin", "operator"]), async (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;

  const blueprintRecord = getArtifact(orgId, "agent_blueprint");
  const profileRecord = getArtifact(orgId, "business_profile");

  if (!blueprintRecord) {
    res.status(422).json({ error: "agent_blueprint artifact is required before resolving specialists" });
    return;
  }
  if (!profileRecord) {
    res.status(422).json({ error: "business_profile artifact is required before resolving specialists" });
    return;
  }

  const blueprint = blueprintRecord.payload as Record<string, unknown>;
  const profile = profileRecord.payload as Record<string, unknown>;

  try {
    const resolutions = await resolveAllChairs(orgId, blueprint, profile);
    writeJsonAtomic(`specialist-matches/${orgId}`, resolutions);

    res.status(200).json({
      resolved: resolutions.length,
      gaps: resolutions.filter((r) => r.resolution.catalog_gap).length,
      matches: resolutions
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "resolution failed" });
  }
});

/** GET /api/v1/org/specialist-matches */
orgRouter.get("/specialist-matches", (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const matches = readJson<BlueprintResolution[]>(`specialist-matches/${orgId}`, []);
  res.status(200).json({ matches });
});

/** POST /api/v1/org/confirm-specialists */
orgRouter.post("/confirm-specialists", requireRole(["admin", "operator"]), async (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const actor = req.ctx!.userId;

  const blueprintRecord = getArtifact(orgId, "agent_blueprint");
  if (!blueprintRecord) {
    res.status(422).json({ error: "agent_blueprint artifact not found" });
    return;
  }

  const pending = readJson<BlueprintResolution[]>(`specialist-matches/${orgId}`, []);
  if (pending.length === 0) {
    res.status(422).json({ error: "no pending specialist matches; run resolve-specialists first" });
    return;
  }

  const updated = applyResolutionsToBlueprint(
    blueprintRecord.payload as Record<string, unknown>,
    pending
  );

  try {
    const record = writeArtifact(orgId, "agent_blueprint" as ArtifactType, updated, actor);
    writeJsonAtomic(`specialist-matches/${orgId}`, []);
    res.status(200).json({ artifact_id: record.artifact_id, version: record.version });
  } catch (err) {
    if (err instanceof ArtifactValidationError) {
      res.status(422).json({ error: "blueprint validation failed after specialist application", details: err.errors });
      return;
    }
    throw err;
  }
});

/** PUT /api/v1/org/chairs/:chair_id/specialists */
orgRouter.put("/chairs/:chair_id/specialists", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const actor = req.ctx!.userId;
  const { chair_id } = req.params;

  const blueprintRecord = getArtifact(orgId, "agent_blueprint");
  if (!blueprintRecord) {
    res.status(404).json({ error: "agent_blueprint not found" });
    return;
  }

  const blueprint = blueprintRecord.payload as Record<string, unknown>;
  const chairs = [...((blueprint.chairs as Array<Record<string, unknown>>) ?? [])];
  const idx = chairs.findIndex((c) => c.chair_id === chair_id);
  if (idx < 0) {
    res.status(404).json({ error: `chair ${chair_id} not found in blueprint` });
    return;
  }

  const body = req.body as { labor_commons_refs?: unknown[] };
  if (!Array.isArray(body.labor_commons_refs)) {
    res.status(400).json({ error: "labor_commons_refs must be an array" });
    return;
  }

  chairs[idx] = { ...chairs[idx], labor_commons_refs: body.labor_commons_refs };
  const updated = { ...blueprint, chairs };

  try {
    const record = writeArtifact(orgId, "agent_blueprint" as ArtifactType, updated, actor);
    res.status(200).json({ artifact_id: record.artifact_id, version: record.version, chair_id });
  } catch (err) {
    if (err instanceof ArtifactValidationError) {
      res.status(422).json({ error: "blueprint validation failed", details: err.errors });
      return;
    }
    throw err;
  }
});

/** GET /api/v1/org/gaps */
orgRouter.get("/gaps", (req: Request, res: Response) => {
  const gaps = loadGaps(req.ctx!.workspaceId);
  res.status(200).json({ gaps });
});

/** POST /api/v1/org/gaps/:gap_id/submit */
orgRouter.post("/gaps/:gap_id/submit", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const { gap_id } = req.params;
  updateGap(orgId, gap_id, { submitted_to_labor_commons: true });
  res.status(200).json({ gap_id, submitted_to_labor_commons: true });
});

/** GET /api/v1/org/catalog-sync */
orgRouter.get("/catalog-sync", requireRole(["admin", "operator"]), async (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  try {
    const notifications = await runCatalogSync(orgId);
    res.status(200).json({ notifications });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "sync failed" });
  }
});
