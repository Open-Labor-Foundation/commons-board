/**
 * Settings route — provider selection, RBAC grants, feature toggles.
 *
 * Hard rule: this endpoint never accepts or returns a credential value.
 * Provider configs carry only `api_key_env` (the NAME of an env var); the
 * secret itself is injected at runtime and resolved at call time.
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

/** Defensive: reject any payload that smuggles a literal credential value. */
function containsCredentialValue(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const norm = k.toLowerCase().replace(/[^a-z0-9]/g, "");
    if ((norm === "apikey" || norm === "secret" || norm === "token") && typeof v === "string" && v !== "") {
      return true;
    }
    if (typeof v === "object" && containsCredentialValue(v)) return true;
  }
  return false;
}

settingsRouter.use(requireContext);

settingsRouter.get("/", (req: Request, res: Response) => {
  res.status(200).json(load(workspaceOf(req)));
});

settingsRouter.put("/", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const body = req.body as Partial<WorkspaceSettings>;
  if (containsCredentialValue(body)) {
    res.status(400).json({ error: "settings must not contain credential values; use api_key_env (an env var name)" });
    return;
  }
  const current = load(workspaceOf(req));
  const merged: WorkspaceSettings = {
    ...current,
    org_name: body.org_name ?? current.org_name,
    governance_mode: body.governance_mode ?? current.governance_mode,
    active_provider_id: body.active_provider_id ?? current.active_provider_id,
    providers: body.providers ?? current.providers,
    rbac: body.rbac ?? current.rbac,
    feature_toggles: body.feature_toggles ?? current.feature_toggles,
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

  res.status(200).json(save(merged));
});
