/**
 * The settings store — per-workspace provider selection, RBAC grants,
 * feature toggles, and inference-queue tuning.
 *
 * Invariants:
 *  - One row per workspace (workspace_id is the PK).
 *  - `save()` is an upsert: INSERT on first save, UPDATE on subsequent.
 *  - `updated_at` is stamped on every save.
 *  - API keys live inside `providers` (JSONB); the route layer is
 *    responsible for masking them in GET responses.
 *
 * Uses PostgreSQL when DATABASE_URL is configured; falls back to the
 * file-backed store otherwise. All functions are async.
 */
import type { Role, WorkspaceSettings } from "@commons-board/shared";
import { readJson, writeJsonAtomic } from "./persistence.js";
import { isDatabaseEnabled, query } from "./db.js";

function key(workspaceId: string): string {
  return `settings/${workspaceId}`;
}

function defaults(workspaceId: string): WorkspaceSettings {
  const grants: Record<Role, string[]> = {
    admin: ["*"],
    operator: ["approve", "trigger_cadence", "manage_settings"],
    member: ["vote", "view"],
    observer: ["view"],
  };
  return {
    workspace_id: workspaceId,
    active_provider_id: "",
    providers: [],
    rbac: { grants },
    feature_toggles: {},
    updated_at: new Date().toISOString(),
  };
}

function loadFile(workspaceId: string): WorkspaceSettings {
  return readJson<WorkspaceSettings>(key(workspaceId), defaults(workspaceId));
}

function saveFile(settings: WorkspaceSettings): WorkspaceSettings {
  const next = { ...settings, updated_at: new Date().toISOString() };
  writeJsonAtomic(key(settings.workspace_id), next);
  return next;
}

/** Map a DB row to a WorkspaceSettings object. */
function rowToSettings(r: Record<string, unknown>): WorkspaceSettings {
  return {
    workspace_id: String(r.workspace_id),
    org_name: r.org_name != null ? String(r.org_name) : undefined,
    governance_mode:
      r.governance_mode != null
        ? (String(r.governance_mode) as WorkspaceSettings["governance_mode"])
        : undefined,
    active_provider_id: String(r.active_provider_id ?? ""),
    providers: Array.isArray(r.providers)
      ? (r.providers as WorkspaceSettings["providers"])
      : [],
    rbac:
      r.rbac != null && typeof r.rbac === "object"
        ? (r.rbac as WorkspaceSettings["rbac"])
        : { grants: { admin: ["*"], operator: [], member: [], observer: [] } },
    feature_toggles:
      r.feature_toggles != null && typeof r.feature_toggles === "object"
        ? (r.feature_toggles as WorkspaceSettings["feature_toggles"])
        : {},
    board_settings:
      r.board_settings != null && typeof r.board_settings === "object"
        ? (r.board_settings as WorkspaceSettings["board_settings"])
        : undefined,
    addin_catalog_url:
      r.addin_catalog_url != null ? String(r.addin_catalog_url) : undefined,
    inference_queue:
      r.inference_queue != null && typeof r.inference_queue === "object"
        ? (r.inference_queue as WorkspaceSettings["inference_queue"])
        : undefined,
    updated_at: String(r.updated_at),
  };
}

/**
 * Load settings for a workspace. Returns defaults if no row exists yet.
 */
export async function loadSettings(workspaceId: string): Promise<WorkspaceSettings> {
  if (isDatabaseEnabled()) {
    const { rows } = await query(
      `SELECT workspace_id, org_name, governance_mode, active_provider_id,
              providers, rbac, feature_toggles, board_settings,
              addin_catalog_url, inference_queue, updated_at
       FROM workspace_settings
       WHERE workspace_id = $1`,
      [workspaceId]
    );
    if (rows.length === 0) return defaults(workspaceId);
    return rowToSettings(rows[0]);
  }
  return loadFile(workspaceId);
}

/**
 * Upsert settings for a workspace. Stamps `updated_at` and returns the
 * persisted record.
 */
export async function saveSettings(settings: WorkspaceSettings): Promise<WorkspaceSettings> {
  const next: WorkspaceSettings = { ...settings, updated_at: new Date().toISOString() };

  if (isDatabaseEnabled()) {
    const { rows } = await query(
      `INSERT INTO workspace_settings
         (workspace_id, org_name, governance_mode, active_provider_id,
          providers, rbac, feature_toggles, board_settings,
          addin_catalog_url, inference_queue, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (workspace_id) DO UPDATE SET
         org_name            = EXCLUDED.org_name,
         governance_mode     = EXCLUDED.governance_mode,
         active_provider_id  = EXCLUDED.active_provider_id,
         providers           = EXCLUDED.providers,
         rbac                = EXCLUDED.rbac,
         feature_toggles     = EXCLUDED.feature_toggles,
         board_settings      = EXCLUDED.board_settings,
         addin_catalog_url   = EXCLUDED.addin_catalog_url,
         inference_queue     = EXCLUDED.inference_queue,
         updated_at          = EXCLUDED.updated_at
       RETURNING workspace_id, org_name, governance_mode, active_provider_id,
                 providers, rbac, feature_toggles, board_settings,
                 addin_catalog_url, inference_queue, updated_at`,
      [
        next.workspace_id,
        next.org_name ?? null,
        next.governance_mode ?? null,
        next.active_provider_id,
        JSON.stringify(next.providers),
        JSON.stringify(next.rbac),
        JSON.stringify(next.feature_toggles),
        next.board_settings ? JSON.stringify(next.board_settings) : null,
        next.addin_catalog_url ?? null,
        next.inference_queue ? JSON.stringify(next.inference_queue) : null,
        next.updated_at,
      ]
    );
    if (rows.length > 0) return rowToSettings(rows[0]);
    return next;
  }
  return saveFile(next);
}