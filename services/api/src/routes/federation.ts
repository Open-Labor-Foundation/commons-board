/**
 * Federation routes — peer-to-peer links between commons-board instances.
 *
 * OLF-original.
 *
 * A federation link is a bilateral connection between two board instances. Each
 * link stores the remote URL and `api_key_env` (the NAME of an env var holding
 * the shared secret — never the secret itself). Phase 14 stubs the outbound
 * HTTP calls; Phase 15 wires real network transport.
 *
 * Routes:
 *   POST   /api/v1/federation/links              — create a federation link
 *   GET    /api/v1/federation/links              — list all links
 *   DELETE /api/v1/federation/links/:id          — remove a link
 *   POST   /api/v1/federation/links/:id/pull     — pull status from linked board
 *   POST   /api/v1/federation/links/:id/share    — push a governance event to linked board
 *   GET    /api/v1/federation/portfolio          — aggregated portfolio view
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { GovernanceEvent } from "@commons-board/shared";
import { requireContext, requireRole } from "../lib/auth.js";
import { asyncHandler } from "../lib/async-handler.js";
import { getArtifact } from "../lib/artifact-store.js";
import { appendEvent } from "../lib/decision-log.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";
import { loadSettings } from "../lib/settings-store.js";

export const federationRouter = Router();
federationRouter.use(requireContext);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LinkStatus = "active" | "paused" | "pending";

type RemoteSnapshot = {
  org_name: string;
  governance_mode: string;
  autonomy_mode: string | null;
  pending_requests: number;
  pending_actions: number;
  pulled_at: string;
};

type FederationLink = {
  id: string;
  workspace_id: string;
  remote_workspace_id: string | null;
  remote_name: string;
  remote_url: string;
  api_key_env: string;
  status: LinkStatus;
  linked_at: string;
  linked_by: string;
  last_pulled_at: string | null;
  last_snapshot: RemoteSnapshot | null;
};

// ---------------------------------------------------------------------------
// Persistence key
// ---------------------------------------------------------------------------

const linksKey = (w: string) => `federation-links/${w}`;

// ---------------------------------------------------------------------------
// Stub: outbound HTTP to linked board (Phase 15 wires real transport)
// ---------------------------------------------------------------------------

async function stubPullRemoteStatus(
  link: FederationLink
): Promise<RemoteSnapshot> {
  // Phase 15 replaces this with:
  //   fetch(`${link.remote_url}/api/v1/settings`, { headers: { "x-api-key": process.env[link.api_key_env] } })
  return {
    org_name: link.remote_name,
    governance_mode: "business",
    autonomy_mode: null,
    pending_requests: 0,
    pending_actions: 0,
    pulled_at: new Date().toISOString()
  };
}

async function stubShareEventToRemote(
  link: FederationLink,
  event: Record<string, unknown>
): Promise<{ delivered: boolean; stub: true }> {
  // Phase 15 replaces this with:
  //   fetch(`${link.remote_url}/api/v1/federation/inbound`, { method: "POST", body: JSON.stringify(event) })
  void link;
  void event;
  return { delivered: false, stub: true };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** POST /api/v1/federation/links */
federationRouter.post("/links", requireRole(["admin"]), asyncHandler(async (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const body = req.body as {
    remote_name?: string;
    remote_url?: string;
    remote_workspace_id?: string;
    api_key_env?: string;
    status?: LinkStatus;
  };

  if (!body.remote_name || !body.remote_url || !body.api_key_env) {
    res.status(400).json({ error: "remote_name, remote_url, and api_key_env are required" });
    return;
  }

  const now = new Date().toISOString();
  const link: FederationLink = {
    id: randomUUID(),
    workspace_id: workspaceId,
    remote_workspace_id: body.remote_workspace_id ? String(body.remote_workspace_id) : null,
    remote_name: String(body.remote_name),
    remote_url: String(body.remote_url).replace(/\/+$/, ""),
    api_key_env: String(body.api_key_env),
    status: body.status ?? "active",
    linked_at: now,
    linked_by: userId,
    last_pulled_at: null,
    last_snapshot: null
  };

  const all = readJson<FederationLink[]>(linksKey(workspaceId), []);
  writeJsonAtomic(linksKey(workspaceId), [...all, link]);

  await appendEvent({
    event_id: randomUUID(),
    org_id: workspaceId,
    event_type: "federation_linked",
    actor: userId,
    artifact_type: null,
    artifact_id: null,
    details: {
      federation_link_id: link.id,
      remote_name: link.remote_name,
      remote_url: link.remote_url,
      remote_workspace_id: link.remote_workspace_id,
      api_key_env: link.api_key_env
    },
    at: now
  } satisfies GovernanceEvent);

  res.status(201).json(link);
}));

/** GET /api/v1/federation/links */
federationRouter.get("/links", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const links = readJson<FederationLink[]>(linksKey(workspaceId), []);
  res.status(200).json({ links, total: links.length });
});

/** DELETE /api/v1/federation/links/:id */
federationRouter.delete("/links/:id", requireRole(["admin"]), asyncHandler(async (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const { id } = req.params;

  const all = readJson<FederationLink[]>(linksKey(workspaceId), []);
  const idx = all.findIndex((l) => l.id === id);
  if (idx === -1) {
    res.status(404).json({ error: "federation link not found" });
    return;
  }

  const removed = all[idx];
  writeJsonAtomic(linksKey(workspaceId), all.filter((_, i) => i !== idx));

  await appendEvent({
    event_id: randomUUID(),
    org_id: workspaceId,
    event_type: "board_request_updated",
    actor: userId,
    artifact_type: null,
    artifact_id: null,
    details: { action: "federation_unlinked", federation_link_id: id, remote_name: removed.remote_name },
    at: new Date().toISOString()
  } satisfies GovernanceEvent);

  res.status(200).json({ removed: true, id });
}));

/** POST /api/v1/federation/links/:id/pull */
federationRouter.post("/links/:id/pull", requireRole(["admin", "operator"]), async (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const { id } = req.params;

  const all = readJson<FederationLink[]>(linksKey(workspaceId), []);
  const idx = all.findIndex((l) => l.id === id);
  if (idx === -1) {
    res.status(404).json({ error: "federation link not found" });
    return;
  }

  const link = all[idx];
  if (link.status !== "active") {
    res.status(409).json({ error: `link is ${link.status} — cannot pull` });
    return;
  }

  const snapshot = await stubPullRemoteStatus(link);
  const updated: FederationLink = {
    ...link,
    last_pulled_at: snapshot.pulled_at,
    last_snapshot: snapshot
  };
  all[idx] = updated;
  writeJsonAtomic(linksKey(workspaceId), all);

  res.status(200).json({ link: updated, snapshot });
});

/** POST /api/v1/federation/links/:id/share */
federationRouter.post("/links/:id/share", requireRole(["admin"]), async (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const { id } = req.params;
  const body = req.body as { event?: Record<string, unknown> };

  if (!body.event || typeof body.event !== "object") {
    res.status(400).json({ error: "event object is required" });
    return;
  }

  const all = readJson<FederationLink[]>(linksKey(workspaceId), []);
  const link = all.find((l) => l.id === id);
  if (!link) {
    res.status(404).json({ error: "federation link not found" });
    return;
  }

  if (link.status !== "active") {
    res.status(409).json({ error: `link is ${link.status} — cannot share` });
    return;
  }

  const result = await stubShareEventToRemote(link, body.event);
  res.status(200).json({ remote_name: link.remote_name, ...result });
});

/** GET /api/v1/federation/portfolio */
federationRouter.get("/portfolio", asyncHandler(async (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;

  const links = readJson<FederationLink[]>(linksKey(workspaceId), []);
  const businessProfile = (await getArtifact(workspaceId, "business_profile"))?.payload ?? null;
  const settings = await loadSettings(workspaceId);
  const activeLinks = links.filter((l) => l.status === "active");
  const totalPendingRequests = activeLinks.reduce(
    (sum, l) => sum + (l.last_snapshot?.pending_requests ?? 0),
    0
  );
  const totalPendingActions = activeLinks.reduce(
    (sum, l) => sum + (l.last_snapshot?.pending_actions ?? 0),
    0
  );

  res.status(200).json({
    local: {
      workspace_id: workspaceId,
      org_name:
        (businessProfile as { org_name?: string } | null)?.org_name ??
        settings.org_name ??
        workspaceId,
      governance_mode: settings.governance_mode ?? "business"
    },
    links,
    portfolio_summary: {
      total_linked: links.length,
      active_links: activeLinks.length,
      total_pending_requests: totalPendingRequests,
      total_pending_actions: totalPendingActions,
      last_refresh: activeLinks
        .map((l) => l.last_pulled_at)
        .filter(Boolean)
        .sort()
        .reverse()[0] ?? null
    }
  });
}));
