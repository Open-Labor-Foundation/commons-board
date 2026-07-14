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

/**
 * Global, in-process concurrency + pacing gate on the active provider for
 * a workspace -- keyed by provider_id, not workspaceId, since the same
 * API key (and its real lane allotment) can be the active provider for
 * more than one workspace.
 *
 * Exists because getProviderConcurrency/mapConcurrent were only ever used
 * *locally*, independently, by each caller (the interview flow,
 * motherboard-chat.ts, agent-job-runner.ts) to bound its own batch of
 * calls -- nothing coordinated across callers, so a request mid-flight in
 * one code path had no way to know a completely unrelated request (a
 * scheduled cadence job, a concurrent chat request) was about to exceed
 * the key's real concurrent-call budget at the same moment.
 *
 * The concurrency cap alone was still not enough live: a strict "never
 * more than maxParallel calls literally in flight" gate still produced
 * a run of HTTP 429s -- because the moment one call's response landed,
 * the next queued call fired immediately, with zero gap. Concurrency and
 * request rate are different constraints; capping the former doesn't cap
 * the latter. MIN_CALL_SPACING_MS enforces a minimum gap between when
 * consecutive calls to the same provider are *granted a slot* (not just
 * "not overlapping"), independent of and in addition to maxParallel.
 */
export const MIN_CALL_SPACING_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const activeCallCounts = new Map<string, number>();
const waitQueues = new Map<string, Array<() => void>>();
const lastGrantedAt = new Map<string, number>();

function acquireConcurrencySlot(providerId: string, maxParallel: number): Promise<void> {
  const current = activeCallCounts.get(providerId) ?? 0;
  if (current < maxParallel) {
    activeCallCounts.set(providerId, current + 1);
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const queue = waitQueues.get(providerId) ?? [];
    queue.push(() => {
      activeCallCounts.set(providerId, (activeCallCounts.get(providerId) ?? 0) + 1);
      resolve();
    });
    waitQueues.set(providerId, queue);
  });
}

async function acquireProviderSlot(providerId: string, maxParallel: number): Promise<() => void> {
  await acquireConcurrencySlot(providerId, maxParallel);
  // Pacing is enforced at grant time, not release time, and applies
  // whether the slot was granted immediately or after queueing -- a call
  // that never had to wait for concurrency still needs to respect the
  // minimum gap since the last call was granted.
  const wait = (lastGrantedAt.get(providerId) ?? 0) + MIN_CALL_SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastGrantedAt.set(providerId, Date.now());
  return () => releaseProviderSlot(providerId);
}

function releaseProviderSlot(providerId: string): void {
  activeCallCounts.set(providerId, Math.max(0, (activeCallCounts.get(providerId) ?? 1) - 1));
  const queue = waitQueues.get(providerId);
  const next = queue?.shift();
  if (next) next();
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

  const lanes = config.concurrency_lanes ?? 1;
  const cost = Math.max(1, config.concurrency_cost ?? 1);
  const maxParallel = Math.max(1, Math.floor(lanes / cost));

  const release = await acquireProviderSlot(config.provider_id, maxParallel);
  try {
    const provider = createProvider(config);
    let response = await provider.complete(req);
    // Concurrency=1 plus MIN_CALL_SPACING_MS pacing still wasn't enough
    // live -- consecutive calls kept coming back HTTP 429 at essentially
    // the same rate as before either fix, meaning the real constraint is
    // stricter than a fixed guessed delay (or something outside this
    // process is also drawing on the same key). Rather than keep
    // widening a fixed constant, back off and retry specifically on 429
    // with increasing delay -- this self-adapts to whatever the real
    // limit turns out to be instead of needing it guessed correctly.
    // Deliberately holds the concurrency slot for the whole backoff: the
    // next queued call retrying immediately into the same rate limit
    // would just fail the same way.
    for (const delayMs of RATE_LIMIT_BACKOFF_MS) {
      if (response.ok || !isRateLimitError(response.error)) break;
      await sleep(delayMs);
      response = await provider.complete(req);
    }
    return response;
  } finally {
    release();
  }
}

const RATE_LIMIT_BACKOFF_MS = [2000, 4000, 8000, 16000];

function isRateLimitError(error: string | undefined): boolean {
  return error != null && /\b429\b/.test(error);
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
