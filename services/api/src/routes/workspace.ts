/**
 * Workspace operational controls. Runtime overrides (kill switch, pause states)
 * that complement but do not supersede the governing artifacts.
 *
 * Routes:
 *   GET   /api/v1/workspace/settings       — read operational settings
 *   PATCH /api/v1/workspace/settings       — update operational settings
 *   GET   /api/v1/workspace/today          — live org status summary
 */
import { Router, type Request, type Response } from "express";
import { getArtifact } from "../lib/artifact-store.js";
import { requireContext, requireRole } from "../lib/auth.js";
import { asyncHandler } from "../lib/async-handler.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";

export const workspaceRouter = Router();

interface OperationalSettings {
  workspace_id: string;
  agents_paused: boolean;
  kill_switch_enabled: boolean;
  kill_switch_reason: string | null;
  paused_connectors: Record<string, boolean>;
  updated_at: string;
}

function defaultSettings(workspaceId: string): OperationalSettings {
  return {
    workspace_id: workspaceId,
    agents_paused: false,
    kill_switch_enabled: false,
    kill_switch_reason: null,
    paused_connectors: {},
    updated_at: new Date().toISOString()
  };
}

function key(workspaceId: string): string {
  return `workspace_ops/${workspaceId}`;
}

function load(workspaceId: string): OperationalSettings {
  return readJson<OperationalSettings>(key(workspaceId), defaultSettings(workspaceId));
}

function save(settings: OperationalSettings): OperationalSettings {
  const next = { ...settings, updated_at: new Date().toISOString() };
  writeJsonAtomic(key(settings.workspace_id), next);
  return next;
}

workspaceRouter.use(requireContext);

workspaceRouter.get("/settings", (req: Request, res: Response) => {
  res.status(200).json(load(req.ctx!.workspaceId));
});

workspaceRouter.patch("/settings", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const body = req.body as Partial<Omit<OperationalSettings, "workspace_id" | "updated_at">>;
  const current = load(orgId);

  const next: OperationalSettings = {
    ...current,
    agents_paused: body.agents_paused ?? current.agents_paused,
    kill_switch_enabled: body.kill_switch_enabled ?? current.kill_switch_enabled,
    kill_switch_reason: body.kill_switch_reason !== undefined ? body.kill_switch_reason : current.kill_switch_reason,
    paused_connectors: body.paused_connectors ?? current.paused_connectors
  };

  res.status(200).json(save(next));
});

workspaceRouter.get("/today", asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const ops = load(orgId);

  const profileRecord = await getArtifact(orgId, "business_profile");
  const policyRecord = await getArtifact(orgId, "autonomy_policy");

  const profile = profileRecord?.payload as Record<string, unknown> | null ?? null;
  const policy = policyRecord?.payload as Record<string, unknown> | null ?? null;

  res.status(200).json({
    org_id: orgId,
    governance_mode: profile?.governance_mode ?? "unknown",
    autonomy_mode: policy?.autonomy_mode ?? "advisor",
    execution_mode: policy?.execution_mode ?? "sim",
    operational: {
      agents_paused: ops.agents_paused,
      kill_switch_enabled: ops.kill_switch_enabled,
      kill_switch_reason: ops.kill_switch_reason
    },
    artifacts_ready: {
      business_profile: profileRecord !== null,
      objective_config: (await getArtifact(orgId, "objective_config")) !== null,
      autonomy_policy: policyRecord !== null,
      cadence_protocol: (await getArtifact(orgId, "cadence_protocol")) !== null,
      agent_blueprint: (await getArtifact(orgId, "agent_blueprint")) !== null,
      collective_config: (await getArtifact(orgId, "collective_config")) !== null
    }
  });
}));

// ---------------------------------------------------------------------------
// Kill-switch routes
// ---------------------------------------------------------------------------

type KillSwitchRecord = {
  enabled: boolean;
  reason?: string;
  set_by: string;
  set_at: string;
};

/** PATCH /kill-switch — enable or disable the workspace kill switch */
workspaceRouter.patch(
  "/kill-switch",
  requireRole(["admin", "operator"]),
  (req: Request, res: Response) => {
    const ctx = req.ctx!;
    const { enabled, reason } = req.body as { enabled: boolean; reason?: string };
    const now = new Date().toISOString();

    const record: KillSwitchRecord = {
      enabled: Boolean(enabled),
      reason: reason?.trim(),
      set_by: ctx.userId,
      set_at: now
    };
    writeJsonAtomic(`kill-switch/${ctx.workspaceId}`, record);

    res.status(200).json(record);
  }
);

/** GET /kill-switch — read current kill switch state */
workspaceRouter.get("/kill-switch", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const record = readJson<KillSwitchRecord | { enabled: false }>(
    `kill-switch/${workspaceId}`,
    { enabled: false }
  );
  res.status(200).json(record);
});

// ---------------------------------------------------------------------------
// Connector pause/resume routes
// ---------------------------------------------------------------------------

const KNOWN_CONNECTORS = ["slack", "crew-bridge", "email", "calendar", "crm"] as const;
type ConnectorName = typeof KNOWN_CONNECTORS[number];

type ConnectorPauseEntry = {
  connector: ConnectorName;
  paused: true;
  reason?: string;
  paused_at: string;
  paused_by: string;
};

type ConnectorPauses = ConnectorPauseEntry[];

/** POST /connectors/:connector/pause — pause a connector */
workspaceRouter.post(
  "/connectors/:connector/pause",
  requireRole(["admin", "operator"]),
  (req: Request, res: Response) => {
    const ctx = req.ctx!;
    const connector = req.params.connector as ConnectorName;
    const { reason } = req.body as { reason?: string };

    if (!(KNOWN_CONNECTORS as readonly string[]).includes(connector)) {
      res.status(400).json({ error: "unknown connector", known: KNOWN_CONNECTORS });
      return;
    }

    const now = new Date().toISOString();
    const pauses = readJson<ConnectorPauses>(`connector-pauses/${ctx.workspaceId}`, []);
    const entry: ConnectorPauseEntry = {
      connector,
      paused: true,
      reason: reason?.trim(),
      paused_at: now,
      paused_by: ctx.userId
    };

    const filtered = pauses.filter((p) => p.connector !== connector);
    filtered.push(entry);
    writeJsonAtomic(`connector-pauses/${ctx.workspaceId}`, filtered);

    res.status(200).json(entry);
  }
);

/** POST /connectors/:connector/resume — resume a connector */
workspaceRouter.post(
  "/connectors/:connector/resume",
  requireRole(["admin", "operator"]),
  (req: Request, res: Response) => {
    const ctx = req.ctx!;
    const connector = req.params.connector as ConnectorName;

    if (!(KNOWN_CONNECTORS as readonly string[]).includes(connector)) {
      res.status(400).json({ error: "unknown connector", known: KNOWN_CONNECTORS });
      return;
    }

    const pauses = readJson<ConnectorPauses>(`connector-pauses/${ctx.workspaceId}`, []);
    const filtered = pauses.filter((p) => p.connector !== connector);
    writeJsonAtomic(`connector-pauses/${ctx.workspaceId}`, filtered);

    res.status(200).json({ connector, paused: false });
  }
);

/** GET /connectors — list all connectors with pause state */
workspaceRouter.get("/connectors", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const pauses = readJson<ConnectorPauses>(`connector-pauses/${workspaceId}`, []);
  const pauseMap = new Map(pauses.map((p) => [p.connector, p]));

  const connectors = KNOWN_CONNECTORS.map((name) => {
    const entry = pauseMap.get(name);
    return entry
      ? { name, paused: true, paused_at: entry.paused_at, reason: entry.reason }
      : { name, paused: false };
  });

  res.status(200).json({ connectors });
});

// ---------------------------------------------------------------------------
// Exported helper
// ---------------------------------------------------------------------------

/**
 * Returns true if the workspace kill switch is currently enabled.
 * Safe to call synchronously from anywhere in the API (reads from
 * the file-backed persistence layer).
 */
export function isWorkspaceKillSwitchEnabled(workspaceId: string): boolean {
  const record = readJson<{ enabled?: boolean }>(`kill-switch/${workspaceId}`, {});
  return record.enabled ?? false;
}
