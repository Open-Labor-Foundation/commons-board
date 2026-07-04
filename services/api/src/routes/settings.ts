/**
 * Settings route — provider selection, RBAC grants, feature toggles.
 *
 * API keys entered by the user are stored in workspace settings (admin-only endpoint).
 * GET masks api_key values — returns "configured" if set, "" if not.
 * PUT preserves an existing api_key when the incoming value is blank.
 */
import { Router, type Request, type Response } from "express";
import type { ProviderConfig, Role, WorkspaceSettings } from "@commons-board/shared";
import { requireContext, requireRole } from "../lib/auth.js";
import { isProviderKindRegistered } from "../lib/provider/index.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";

export const settingsRouter = Router();

function key(workspaceId: string): string {
  return `settings/${workspaceId}`;
}

function defaults(workspaceId: string): WorkspaceSettings {
  const grants: Record<Role, string[]> = {
    admin: ["*"],
    operator: ["approve", "trigger_cadence", "manage_settings"],
    member: ["vote", "view"],
    observer: ["view"]
  };
  return {
    workspace_id: workspaceId,
    active_provider_id: "",
    providers: [],
    rbac: { grants },
    feature_toggles: {},
    updated_at: new Date().toISOString()
  };
}

function load(workspaceId: string): WorkspaceSettings {
  return readJson<WorkspaceSettings>(key(workspaceId), defaults(workspaceId));
}

function save(settings: WorkspaceSettings): WorkspaceSettings {
  const next = { ...settings, updated_at: new Date().toISOString() };
  writeJsonAtomic(key(settings.workspace_id), next);
  return next;
}

function workspaceOf(req: Request): string {
  return req.ctx?.workspaceId ?? req.header("x-workspace-id") ?? "default";
}

/** Mask api_key in the GET response — return "configured" if set, "" if not. */
function maskProviders(providers: ProviderConfig[]): ProviderConfig[] {
  return providers.map(p => ({
    ...p,
    api_key: p.api_key && p.api_key.trim() !== "" ? "configured" : ""
  }));
}

/**
 * Merge incoming providers with existing, preserving stored api_key when the
 * incoming value is blank (user didn't change it).
 */
function mergeProviders(incoming: ProviderConfig[], existing: ProviderConfig[]): ProviderConfig[] {
  return incoming.map(p => {
    const prior = existing.find(e => e.provider_id === p.provider_id);
    const resolvedKey = p.api_key && p.api_key.trim() !== ""
      ? p.api_key.trim()
      : (prior?.api_key ?? null);
    return { ...p, api_key: resolvedKey };
  });
}

settingsRouter.use(requireContext);

settingsRouter.get("/", (req: Request, res: Response) => {
  const settings = load(workspaceOf(req));
  res.status(200).json({
    ...settings,
    providers: maskProviders(settings.providers)
  });
});

settingsRouter.put("/", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const body = req.body as Partial<WorkspaceSettings>;
  const current = load(workspaceOf(req));

  const incomingProviders = body.providers ?? current.providers;
  const mergedProviders = mergeProviders(incomingProviders, current.providers);

  const merged: WorkspaceSettings = {
    ...current,
    org_name: body.org_name ?? current.org_name,
    governance_mode: body.governance_mode ?? current.governance_mode,
    active_provider_id: body.active_provider_id ?? current.active_provider_id,
    providers: mergedProviders,
    rbac: body.rbac ?? current.rbac,
    feature_toggles: body.feature_toggles ?? current.feature_toggles,
    board_settings: body.board_settings ?? current.board_settings,
    addin_catalog_url: body.addin_catalog_url !== undefined ? (body.addin_catalog_url || undefined) : current.addin_catalog_url,
    workspace_id: current.workspace_id
  };

  if (merged.active_provider_id) {
    const cfg = merged.providers.find((p: ProviderConfig) => p.provider_id === merged.active_provider_id);
    if (!cfg) {
      res.status(400).json({ error: `active_provider_id "${merged.active_provider_id}" is not in providers` });
      return;
    }
    if (!isProviderKindRegistered(cfg.kind)) {
      res.status(400).json({ error: `no adapter registered for provider kind "${cfg.kind}"` });
      return;
    }
  }

  const saved = save(merged);
  res.status(200).json({
    ...saved,
    providers: maskProviders(saved.providers)
  });
});
