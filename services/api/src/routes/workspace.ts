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

workspaceRouter.get("/today", (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const ops = load(orgId);

  const profileRecord = getArtifact(orgId, "business_profile");
  const policyRecord = getArtifact(orgId, "autonomy_policy");

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
      objective_config: getArtifact(orgId, "objective_config") !== null,
      autonomy_policy: policyRecord !== null,
      cadence_protocol: getArtifact(orgId, "cadence_protocol") !== null,
      agent_blueprint: getArtifact(orgId, "agent_blueprint") !== null,
      collective_config: getArtifact(orgId, "collective_config") !== null
    }
  });
});
