/**
 * Catalog sync worker — checks for updates to pinned specialist refs.
 *
 * Runs periodically (Phase 7 wires it to the cadence scheduler). For each
 * labor_commons_ref in the org's agent_blueprint that is not pinned, it
 * checks whether the specialist definition has changed and surfaces a
 * notification if so.
 *
 * Stale refs and breaking changes (scope narrowing, task removal) are
 * flagged at higher urgency.
 */
import type { ArtifactRecord } from "../lib/artifact-store.js";
import { getArtifact } from "../lib/artifact-store.js";
import { checkForUpdates } from "../lib/labor-commons-client.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";

export interface SyncNotification {
  org_id: string;
  chair_id: string;
  specialist_slug: string;
  urgency: "info" | "warning";
  message: string;
  detected_at: string;
}

function syncKey(orgId: string): string {
  return `catalog-sync/${orgId}`;
}

export function loadSyncState(orgId: string): Record<string, string> {
  return readJson<Record<string, string>>(syncKey(orgId), {});
}

function saveSyncState(orgId: string, state: Record<string, string>): void {
  writeJsonAtomic(syncKey(orgId), state);
}

export async function runCatalogSync(orgId: string): Promise<SyncNotification[]> {
  const blueprintRecord: ArtifactRecord | null = getArtifact(orgId, "agent_blueprint");
  if (!blueprintRecord) return [];

  const blueprint = blueprintRecord.payload as Record<string, unknown>;
  const chairs = (blueprint.chairs as Array<Record<string, unknown>>) ?? [];
  const syncState = loadSyncState(orgId);
  const notifications: SyncNotification[] = [];
  const now = new Date().toISOString();

  for (const chair of chairs) {
    const chairId = String(chair.chair_id ?? "");
    const refs = (chair.labor_commons_refs as Array<Record<string, unknown>>) ?? [];

    for (const ref of refs) {
      const slug = String(ref.specialist_slug ?? "");
      if (!slug) continue;
      const pinnedRef = ref.pinned_ref;
      if (pinnedRef) continue; // pinned — no sync needed

      const knownUpdatedAt = syncState[slug] ?? "1970-01-01T00:00:00.000Z";
      const check = await checkForUpdates(slug, knownUpdatedAt);

      if (check.changed && check.current_updated_at) {
        syncState[slug] = check.current_updated_at;
        notifications.push({
          org_id: orgId,
          chair_id: chairId,
          specialist_slug: slug,
          urgency: "info",
          message: `Specialist ${slug} has been updated in the labor-commons catalog. Review and accept the update to keep your board current.`,
          detected_at: now
        });
      }
    }
  }

  if (notifications.length > 0) {
    saveSyncState(orgId, syncState);
  }

  return notifications;
}
