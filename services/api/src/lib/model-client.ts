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

/**
 * Returns the effective concurrency budget for the active provider of a workspace.
 * maxParallel = floor(lanes / cost) — the number of calls that can run simultaneously
 * without exceeding the API key's lane allotment.
 */
export function getProviderConcurrency(workspaceId: string): {
  lanes: number;
  cost: number;
  maxParallel: number;
} {
  const settings = loadSettings(workspaceId);
  const config = settings?.providers.find((p) => p.provider_id === settings?.active_provider_id);
  const lanes = config?.concurrency_lanes ?? 1;
  const cost = Math.max(1, config?.concurrency_cost ?? 1);
  return { lanes, cost, maxParallel: Math.max(1, Math.floor(lanes / cost)) };
}

/**
 * Like Promise.all but runs at most `limit` tasks concurrently.
 * Preserves result order. Each task that throws surfaces its error as a rejected
 * element — wrap each task in try/catch if you want graceful degradation.
 */
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length) as R[];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}

/**
 * Parse <think>...</think> chain-of-thought blocks emitted by thinking models
 * (Qwen3, DeepSeek-R1, etc.) into separate thinking and answer parts.
 */
export function parseThinking(raw: string): { thinking: string; answer: string } {
  const match = raw.match(/^<think>([\s\S]*?)<\/think>\s*/);
  if (match) {
    return { thinking: match[1].trim(), answer: raw.slice(match[0].length).trim() };
  }
  return { thinking: "", answer: raw.trim() };
}

type CompleteOptions = { max_tokens?: number; temperature?: number; correlation_id?: string; model?: string };

/** Returns only the final answer — strips thinking. Used for synthesis and worker agents. */
export async function completeText(
  workspaceId: string,
  system: string,
  prompt: string,
  options?: CompleteOptions
): Promise<string> {
  const resp = await complete(workspaceId, {
    system, prompt,
    max_tokens: options?.max_tokens,
    temperature: options?.temperature,
    correlation_id: options?.correlation_id,
    model: options?.model,
  });
  if (!resp.ok) {
    throw new Error(`inference failed (${resp.provider_id}): ${resp.error ?? "unknown error"}`);
  }
  return parseThinking(resp.text).answer;
}

/** Multi-turn chat: sends full conversation history to the model and returns the reply. */
export async function completeChat(
  workspaceId: string,
  system: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  message: string,
  options?: { temperature?: number; model?: string }
): Promise<{ answer: string; thinking: string; model: string }> {
  const resp = await complete(workspaceId, {
    system,
    prompt: message,
    history,
    temperature: options?.temperature,
    model: options?.model,
  });
  if (!resp.ok) {
    throw new Error(`inference failed (${resp.provider_id}): ${resp.error ?? "unknown error"}`);
  }
  const { answer, thinking } = parseThinking(resp.text);
  return { answer, thinking, model: resp.model };
}

/** Returns both the thinking block and the final answer separately. Used for chair reasoning. */
export async function completeTextWithThinking(
  workspaceId: string,
  system: string,
  prompt: string,
  options?: CompleteOptions
): Promise<{ thinking: string; answer: string }> {
  const resp = await complete(workspaceId, {
    system, prompt,
    max_tokens: options?.max_tokens,
    temperature: options?.temperature,
    correlation_id: options?.correlation_id,
    model: options?.model,
  });
  if (!resp.ok) {
    throw new Error(`inference failed (${resp.provider_id}): ${resp.error ?? "unknown error"}`);
  }
  return parseThinking(resp.text);
}
