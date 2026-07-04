import { Router, type Request } from "express";
import type { WorkspaceSettings } from "@commons-board/shared";
import { getInstalledAddins, readRegistry, fetchCatalog, getAddinDir, isValidAddinId } from "../lib/addin-registry.js";
import { installPack, uninstallPack, readPackReadme, getRebuildPending, clearRebuildPending, writeRebuildSignal } from "../lib/addin-install.js";
import { findComposeContainer, restartContainer } from "../lib/docker-client.js";
import { readJson } from "../lib/persistence.js";
import { requireContext, requireRole } from "../lib/auth.js";

function workspaceOf(req: Request): string {
  return req.ctx?.workspaceId ?? req.header("x-workspace-id") ?? "default";
}

function catalogUrl(req: Request): string | undefined {
  const ws = readJson<WorkspaceSettings>(`settings/${workspaceOf(req)}`, null as unknown as WorkspaceSettings);
  return ws?.addin_catalog_url || undefined;
}

export const addinsRouter = Router();
addinsRouter.use(requireContext);

/** GET /api/v1/addins — installed packs */
addinsRouter.get("/", (_req, res) => {
  res.json({ installed: getInstalledAddins() });
});

/** GET /api/v1/addins/catalog — available packs from remote catalog, merged with installed state */
addinsRouter.get("/catalog", async (req, res) => {
  try {
    const [packs, installedIds] = await Promise.all([
      fetchCatalog(catalogUrl(req)),
      Promise.resolve(readRegistry()),
    ]);
    const merged = packs.map(p => ({ ...p, installed: installedIds.includes(p.id) }));
    res.json({ packs: merged });
  } catch (err) {
    const message = err instanceof Error ? err.message : "catalog unavailable";
    res.status(503).json({ error: message, packs: [] });
  }
});

/** POST /api/v1/addins/:id/install — install a pack */
addinsRouter.post("/:id/install", requireRole(["admin", "operator"]), async (req, res) => {
  const { id } = req.params;
  if (!isValidAddinId(id)) {
    res.status(400).json({ error: `invalid addin id "${id}"` });
    return;
  }
  try {
    const packs = await fetchCatalog(catalogUrl(req));
    const pack = packs.find(p => p.id === id);
    if (!pack) {
      res.status(404).json({ error: `Pack "${id}" not found in catalog` });
      return;
    }
    const result = installPack(pack);
    res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "install failed";
    res.status(500).json({ error: message });
  }
});

/** DELETE /api/v1/addins/:id — uninstall a pack */
addinsRouter.delete("/:id", requireRole(["admin", "operator"]), (req, res) => {
  const { id } = req.params;
  if (!isValidAddinId(id)) {
    res.status(400).json({ error: `invalid addin id "${id}"` });
    return;
  }
  const installed = readRegistry();
  if (!installed.includes(id)) {
    res.status(404).json({ error: `Pack "${id}" is not installed` });
    return;
  }
  uninstallPack(id);
  res.status(200).json({ id, installed: false });
});

/** GET /api/v1/addins/rebuild-status — check if a web rebuild is pending */
addinsRouter.get("/rebuild-status", (_req, res) => {
  res.json(getRebuildPending(getAddinDir()));
});

/** POST /api/v1/addins/rebuild-dismiss — clear the rebuild-pending signal once user has rebuilt */
addinsRouter.post("/rebuild-dismiss", requireRole(["admin", "operator"]), (_req, res) => {
  clearRebuildPending(getAddinDir());
  res.json({ cleared: true });
});

/** POST /api/v1/addins/rebuild — write signal file and restart web container */
addinsRouter.post("/rebuild", requireRole(["admin", "operator"]), async (_req, res) => {
  try {
    writeRebuildSignal();
    const container = await findComposeContainer("web");
    if (!container) {
      res.status(503).json({
        error: "Web container not found. Restart manually: docker compose up --build web",
        triggered: false,
      });
      return;
    }
    await restartContainer(container.Id);
    res.json({ triggered: true, containerId: container.Id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "rebuild trigger failed";
    res.status(500).json({ error: message, triggered: false });
  }
});

/** GET /api/v1/addins/:id/readme — serve pack README as JSON */
addinsRouter.get("/:id/readme", (req, res) => {
  const { id } = req.params;
  if (!isValidAddinId(id)) {
    res.status(400).json({ error: `invalid addin id "${id}"` });
    return;
  }
  const content = readPackReadme(id);
  if (!content) {
    res.status(404).json({ error: "README not available" });
    return;
  }
  res.json({ content });
});
