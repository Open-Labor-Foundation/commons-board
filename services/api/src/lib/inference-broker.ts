/**
 * The addin app inference lane: the single place a satellite app's
 * inference request enters commons-board. This is deliberately separate
 * from which provider backend fulfills it (Featherless, OLF Managed, or
 * anything else configured in workspace settings) -- that choice already
 * lives in model-client.ts's complete(), which resolves the workspace's
 * configured provider and its key server-side via resolveApiKey().
 *
 * The property this exists to guarantee: no addin, satellite, or site
 * controller ever holds a provider key. An addin sends its inference need
 * here; commons-board is the only place the key is resolved, and every
 * request is logged under one governance surface regardless of which
 * provider actually served it.
 */
import { randomUUID } from "node:crypto";
import { complete } from "./model-client.js";
import { appendEvent } from "./decision-log.js";

export interface BrokerInferenceParams {
  /** Free-text identifier of the calling app, e.g. "restaurant-platform:manager-console". Not yet validated against a registered app list. */
  source: string;
  system: string;
  prompt: string;
  max_tokens?: number;
  temperature?: number;
}

export interface BrokerInferenceResult {
  text: string;
  model: string;
}

/**
 * Brokers an addin's inference request through commons-board's already-
 * configured provider. Throws NoProviderConfiguredError (from model-client)
 * if the workspace has no active provider -- the caller maps that to a
 * clear error, it never falls back to a default.
 */
export async function brokerInferenceRequest(
  workspaceId: string,
  actor: string,
  params: BrokerInferenceParams
): Promise<BrokerInferenceResult> {
  const resp = await complete(workspaceId, {
    system: params.system,
    prompt: params.prompt,
    max_tokens: params.max_tokens,
    temperature: params.temperature,
  });

  appendEvent({
    event_id: randomUUID(),
    org_id: workspaceId,
    event_type: "inference_request_brokered",
    actor,
    artifact_type: null,
    artifact_id: null,
    details: {
      source: params.source,
      ok: resp.ok,
      model: resp.model,
      total_tokens: resp.usage?.total_tokens ?? null,
      error: resp.ok ? null : resp.error,
    },
    at: new Date().toISOString(),
  });

  if (!resp.ok) {
    throw new Error(`inference failed (${resp.provider_id}): ${resp.error ?? "unknown error"}`);
  }
  return { text: resp.text, model: resp.model };
}
