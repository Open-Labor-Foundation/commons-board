/**
 * Thin LLM abstraction over the configured inference provider.
 *
 * Used only for: interview conversation, artifact draft generation, brief writing.
 * Hard boundary: never used for approvals, audit, risk classification, or
 * permission checks. Governance decisions are deterministic, not model-driven.
 *
 * The active provider is read from workspace settings at call time. No
 * credentials are stored here; the provider adapter resolves them from env vars.
 */
import type { InferenceRequest, InferenceResponse } from "@commons-board/shared";
import type { WorkspaceSettings } from "@commons-board/shared";
import { createProvider } from "./provider/index.js";
import { readJson } from "./persistence.js";

function loadSettings(workspaceId: string): WorkspaceSettings | null {
  const settings = readJson<WorkspaceSettings | null>(`settings/${workspaceId}`, null);
  return settings;
}

export class NoProviderConfiguredError extends Error {
  constructor(workspaceId: string) {
    super(`no active inference provider configured for workspace ${workspaceId}`);
    this.name = "NoProviderConfiguredError";
  }
}

export async function complete(
  workspaceId: string,
  req: Omit<InferenceRequest, "correlation_id"> & { correlation_id?: string }
): Promise<InferenceResponse> {
  const settings = loadSettings(workspaceId);

  if (!settings || !settings.active_provider_id || settings.providers.length === 0) {
    throw new NoProviderConfiguredError(workspaceId);
  }

  const config = settings.providers.find((p) => p.provider_id === settings.active_provider_id);
  if (!config) {
    throw new NoProviderConfiguredError(workspaceId);
  }

  const provider = createProvider(config);
  return provider.complete(req);
}

/** Convenience wrapper that extracts text or throws on provider error. */
export async function completeText(
  workspaceId: string,
  system: string,
  prompt: string,
  options?: { max_tokens?: number; temperature?: number; correlation_id?: string }
): Promise<string> {
  const resp = await complete(workspaceId, {
    system,
    prompt,
    max_tokens: options?.max_tokens,
    temperature: options?.temperature,
    correlation_id: options?.correlation_id
  });

  if (!resp.ok) {
    throw new Error(`inference failed (${resp.provider_id}): ${resp.error ?? "unknown error"}`);
  }

  return resp.text;
}
