/**
 * Child runtime client — lifecycle calls (start/stop/status) and
 * hash-chained transfer manifest signing for child workspace linkage.
 *
 * Ported from mother-board services/child-runtime-client.ts.
 * Added: signTransferManifest() for hash-chained handoff receipts.
 */
import { createHash, randomUUID } from "node:crypto";
import { signPayload } from "../lib/governance-signing.js";

export type ChildRuntimeRef = {
  id: string;
  child_workspace_id: string;
  name: string;
  runtime: {
    api_base_url?: string;
  };
};

export type ChildRuntimeResponse = {
  ok: boolean;
  status: number;
  payload: unknown;
};

export type TransferManifest = {
  manifest_id: string;
  source_workspace_id: string;
  target_child_id: string;
  target_workspace_id: string;
  artifact_types: string[];
  initiated_at: string;
  manifest_hash: string;
};

function childRuntimeUrl(baseUrl: string, route: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedRoute = route.startsWith("/") ? route.slice(1) : route;
  return new URL(normalizedRoute, normalizedBase).toString();
}

export async function callChildRuntime(
  child: ChildRuntimeRef,
  route: string,
  init?: RequestInit
): Promise<ChildRuntimeResponse> {
  const baseUrl = child.runtime.api_base_url;
  if (!baseUrl) {
    return { ok: false, status: 409, payload: { error: "child has no api_base_url configured" } };
  }
  try {
    const response = await fetch(childRuntimeUrl(baseUrl, route), init);
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }
    return { ok: response.ok, status: response.status, payload };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      payload: {
        error: "child_runtime_unreachable",
        detail: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

export async function startChildRuntime(child: ChildRuntimeRef): Promise<ChildRuntimeResponse> {
  return callChildRuntime(child, "/api/v1/workspace/activate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ child_id: child.id }) });
}

export async function stopChildRuntime(child: ChildRuntimeRef): Promise<ChildRuntimeResponse> {
  return callChildRuntime(child, "/api/v1/workspace/deactivate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ child_id: child.id }) });
}

export async function statusChildRuntime(child: ChildRuntimeRef): Promise<ChildRuntimeResponse> {
  return callChildRuntime(child, "/health");
}

/** Build and sign a hash-chained transfer manifest for inter-runtime handoff. */
export function signTransferManifest(
  sourceWorkspaceId: string,
  child: ChildRuntimeRef,
  artifactTypes: string[],
  previousManifestHash: string | null
): { manifest: TransferManifest; signed: ReturnType<typeof signPayload> } {
  const now = new Date().toISOString();
  const rawContent = JSON.stringify({
    source_workspace_id: sourceWorkspaceId,
    target_child_id: child.id,
    target_workspace_id: child.child_workspace_id,
    artifact_types: artifactTypes,
    initiated_at: now,
    previous_hash: previousManifestHash ?? "0".repeat(64)
  });
  const manifest_hash = createHash("sha256").update(rawContent).digest("hex");
  const manifest: TransferManifest = {
    manifest_id: randomUUID(),
    source_workspace_id: sourceWorkspaceId,
    target_child_id: child.id,
    target_workspace_id: child.child_workspace_id,
    artifact_types: artifactTypes,
    initiated_at: now,
    manifest_hash
  };
  return { manifest, signed: signPayload(manifest) };
}
