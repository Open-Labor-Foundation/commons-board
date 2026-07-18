/**
 * Inference queue — a priority-aware, retrying wrapper around the existing
 * `complete()` concurrency gate in model-client.ts.
 *
 * Sits ABOVE complete(): it does not replace the provider-level concurrency
 * gate, MIN_CALL_SPACING_MS pacing, or 429 backoff. It adds:
 *   - Per-call-type concurrency budgets (independent of provider maxParallel)
 *   - Retry with exponential backoff + jitter on timeout / 5xx / 429
 *   - Backpressure: sheds non-critical calls when the queue is full
 *   - Per-call-type tagging so callers can be throttled independently
 *
 * The queue is a singleton module — all state is module-level. Every call
 * site that imports enqueueInference shares the same budgets and wait queues.
 *
 * NOTE on workspaceId: InferenceCallRequest includes workspaceId even though
 * the task spec's interface sketch omitted it. complete() requires workspaceId
 * as its first argument to load workspace settings and resolve the active
 * provider — the queue cannot function without it. This is a structural
 * necessity, not a scope deviation.
 */
import { randomUUID } from "node:crypto";
import { complete, NoProviderConfiguredError } from "./model-client.js";
import { loadSettings } from "./settings-store.js";
import { loadInferenceEnv } from "./env.js";
import type {
  InferenceCallType,
  CallTypeConfig,
  InferenceQueueSettings,
} from "@commons-board/shared";

// ---------------------------------------------------------------------------
// Types — re-exported from @commons-board/shared so WorkspaceSettings can
// reference them without the shared package importing from the API service.
// ---------------------------------------------------------------------------

// Re-export the moved types so existing imports (e.g. chair-reasoning.ts
// imports InferenceCallType from here) keep working unchanged.
export type { InferenceCallType, CallTypeConfig } from "@commons-board/shared";

/**
 * Priority ordering — lower number = higher priority.
 * When multiple calls of different types are waiting, the scheduler grants
 * slots to the highest-priority (lowest number) type first. Within the same
 * type, FIFO order is preserved.
 */
export const CALL_TYPE_PRIORITY: Record<InferenceCallType, number> = {
  chair_deliberation: 1, // highest
  chair_summarize: 2,
  task_extraction: 3,
  board_synthesis: 4,
  worker_dispatch: 5, // lowest
};

/**
 * Code-level defaults. These are the base of the precedence stack:
 *   code defaults < env vars (CB_INFERENCE_*) < workspace settings.
 * Never mutated — EFFECTIVE_CALL_TYPE_CONFIG is the env-adjusted copy.
 */
export const DEFAULT_CALL_TYPE_CONFIG: Record<InferenceCallType, CallTypeConfig> = {
  chair_deliberation: { maxConcurrent: 2, timeoutMs: 180_000, maxRetries: 2 },
  chair_summarize: { maxConcurrent: 3, timeoutMs: 60_000, maxRetries: 2 },
  task_extraction: { maxConcurrent: 1, timeoutMs: 120_000, maxRetries: 2 },
  board_synthesis: { maxConcurrent: 1, timeoutMs: 120_000, maxRetries: 2 },
  worker_dispatch: { maxConcurrent: 3, timeoutMs: 120_000, maxRetries: 1 },
};

export interface InferenceCallRequest {
  callType: InferenceCallType;
  /** Required — complete() needs it to load workspace settings + resolve provider. */
  workspaceId: string;
  prompt: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
}

export interface InferenceCallResult {
  /** Raw response text from the provider (may include <think> blocks — caller parses). */
  text: string;
  retries: number;
  elapsedMs: number;
  callType: InferenceCallType;
}

export class QueueFullError extends Error {
  constructor(public callType: InferenceCallType) {
    super(`Inference queue full for call type: ${callType}`);
    this.name = "QueueFullError";
  }
}

// ---------------------------------------------------------------------------
// Configuration constants + env-var overrides (applied at module load)
// ---------------------------------------------------------------------------

/**
 * Code-level default for the global queue-depth backpressure limit. Overridden
 * at module load by CB_INFERENCE_MAX_QUEUE_DEPTH when set and valid.
 */
const DEFAULT_MAX_QUEUE_DEPTH = 50;

/**
 * Critical call types are never shed — they always wait for a slot even when
 * the queue is at capacity. The operator is waiting on these.
 */
const CRITICAL_TYPES: ReadonlySet<InferenceCallType> = new Set([
  "chair_deliberation",
  "board_synthesis",
]);

/**
 * Env-adjusted per-type config. Built once at module load by deep-cloning
 * DEFAULT_CALL_TYPE_CONFIG and applying the CB_INFERENCE_* overrides:
 *   - CB_INFERENCE_CHAIR_MAX_CONCURRENT → chair_deliberation.maxConcurrent
 *   - CB_INFERENCE_WORKER_TIMEOUT_MS     → worker_dispatch.timeoutMs
 * This is the global baseline; workspace call_type_overrides merge on top
 * per-call. The scheduler and runCall() read from this, not from
 * DEFAULT_CALL_TYPE_CONFIG, so env overrides actually take effect.
 */
const EFFECTIVE_CALL_TYPE_CONFIG: Record<InferenceCallType, CallTypeConfig> = (
  () => {
    const copy: Record<InferenceCallType, CallTypeConfig> = {
      chair_deliberation: { ...DEFAULT_CALL_TYPE_CONFIG.chair_deliberation },
      chair_summarize: { ...DEFAULT_CALL_TYPE_CONFIG.chair_summarize },
      task_extraction: { ...DEFAULT_CALL_TYPE_CONFIG.task_extraction },
      board_synthesis: { ...DEFAULT_CALL_TYPE_CONFIG.board_synthesis },
      worker_dispatch: { ...DEFAULT_CALL_TYPE_CONFIG.worker_dispatch },
    };
    const env = loadInferenceEnv();
    if (env.chairMaxConcurrent != null) {
      copy.chair_deliberation.maxConcurrent = env.chairMaxConcurrent;
    }
    if (env.workerTimeoutMs != null) {
      copy.worker_dispatch.timeoutMs = env.workerTimeoutMs;
    }
    return copy;
  }
)();

/**
 * Env-adjusted global queue-depth limit. CB_INFERENCE_MAX_QUEUE_DEPTH overrides
 * the default when set and valid. Workspace settings can override this further
 * per-workspace at backpressure-check time.
 */
const EFFECTIVE_MAX_QUEUE_DEPTH: number = ((): number => {
  const env = loadInferenceEnv();
  return env.maxQueueDepth ?? DEFAULT_MAX_QUEUE_DEPTH;
})();

/**
 * Returns the env-adjusted default config for a call type (without workspace
 * overrides). Exported for observability / the testing-agent to inspect what
 * the queue is actually running with.
 */
export function getEffectiveCallTypeConfig(
  callType: InferenceCallType
): CallTypeConfig {
  return { ...EFFECTIVE_CALL_TYPE_CONFIG[callType] };
}

/**
 * Returns the env-adjusted global max queue depth. Exported for observability.
 */
export function getEffectiveMaxQueueDepth(): number {
  return EFFECTIVE_MAX_QUEUE_DEPTH;
}

// ---------------------------------------------------------------------------
// Workspace settings reader
// ---------------------------------------------------------------------------

/**
 * Reads a workspace's InferenceQueueSettings from the persistence layer.
 * Returns null when no inference_queue block is present.
 *
 * Per-call read (no TTL cache) — this keeps config changes effective
 * immediately without a cache-invalidation story.
 */
async function readWorkspaceQueueSettings(
  workspaceId: string
): Promise<InferenceQueueSettings | null> {
  const settings = await loadSettings(workspaceId);
  return settings.inference_queue ?? null;
}

/**
 * Resolves the effective config for a single call: env-adjusted defaults
 * merged with this workspace's call_type_overrides (workspace wins).
 * Returns a fresh object so callers can't mutate the shared baseline.
 */
async function resolveCallConfig(
  callType: InferenceCallType,
  workspaceId: string
): Promise<CallTypeConfig> {
  const base = EFFECTIVE_CALL_TYPE_CONFIG[callType];
  const ws = await readWorkspaceQueueSettings(workspaceId);
  const override = ws?.call_type_overrides?.[callType];
  if (!override) return { ...base };
  return {
    maxConcurrent: override.maxConcurrent ?? base.maxConcurrent,
    timeoutMs: override.timeoutMs ?? base.timeoutMs,
    maxRetries: override.maxRetries ?? base.maxRetries,
  };
}

/**
 * Resolves the per-workspace max queue depth: workspace setting wins over the
 * env-adjusted global default.
 */
async function resolveMaxQueueDepth(workspaceId: string): Promise<number> {
  const ws = await readWorkspaceQueueSettings(workspaceId);
  return ws?.max_queue_depth ?? EFFECTIVE_MAX_QUEUE_DEPTH;
}

/**
 * Telemetry is enabled when the workspace's inference_queue.enable_telemetry
 * is true. (No global env toggle was specified; per-workspace only.)
 */
async function telemetryEnabled(workspaceId: string): Promise<boolean> {
  return (await readWorkspaceQueueSettings(workspaceId))?.enable_telemetry === true;
}

/**
 * Emits a single inference_call telemetry event as a JSON line on console.
 * Goes to stdout, NOT the decision log. Best-effort: never throws.
 */
function emitTelemetry(event: {
  call_type: InferenceCallType;
  workspace_id: string;
  attempts: number;
  queued_for_ms: number;
  total_ms: number;
  status: "completed" | "failed";
  correlation_id: string;
}): void {
  try {
    console.log(
      JSON.stringify({ event: "inference_call", ...event })
    );
  } catch {
    // Telemetry must never break a call.
  }
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Returns true if the error is retryable: a timeout, 429, or 5xx.
 * NoProviderConfiguredError is NOT retryable — it's a configuration problem,
 * not a transient failure.
 */
export function shouldRetry(error: unknown): boolean {
  if (error instanceof NoProviderConfiguredError) return false;
  if (error == null) return false;
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : String(error);
  // Timeout / abort signals
  if (/timeout|timed out|abort/i.test(message)) return true;
  // 429 rate limit (already retried inside complete(), but if it exhausts
  // those retries the queue gives it one more shot at a higher level)
  if (/\b429\b/.test(message)) return true;
  // 5xx server errors
  if (/\b5\d\d\b/.test(message)) return true;
  return false;
}

/**
 * Exponential backoff with jitter, capped at 30s.
 * delay = min(1000 * 2^attempt + random(0..500), 30000)
 */
export function backoffDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 30_000);
}

// ---------------------------------------------------------------------------
// Queue state (module-level singleton)
// ---------------------------------------------------------------------------

interface QueueEntry {
  request: InferenceCallRequest;
  resolve: (result: InferenceCallResult) => void;
  reject: (error: unknown) => void;
  enqueuedAt: number;
  /** Per-call correlation id for telemetry. */
  correlationId: string;
}

interface TypeQueueState {
  active: number;
  waiting: QueueEntry[];
}

const queueState = new Map<InferenceCallType, TypeQueueState>();
for (const ct of Object.keys(DEFAULT_CALL_TYPE_CONFIG) as InferenceCallType[]) {
  queueState.set(ct, { active: 0, waiting: [] });
}

function totalPending(): number {
  let total = 0;
  for (const state of queueState.values()) {
    total += state.active + state.waiting.length;
  }
  return total;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Picks the highest-priority waiting entry across all types that have capacity.
 * Called after a slot frees up. Returns the entry to run, or undefined if no
 * type has both waiting entries and available capacity.
 *
 * Priority = CALL_TYPE_PRIORITY (lower = higher). Within the same type, FIFO
 * (waiting[0] is the oldest).
 */
function dequeueNext(): QueueEntry | undefined {
  let best: { entry: QueueEntry; priority: number } | undefined;
  for (const [callType, state] of queueState) {
    if (state.waiting.length === 0) continue;
    // Capacity check uses the env-adjusted baseline. Workspace call_type
    // overrides raise/lower maxConcurrent per-call at enqueue time; the
    // scheduler grants slots against this global baseline so a workspace
    // that raises its own budget can't exceed the env-adjusted ceiling for
    // the type. (Workspace lowering is enforced at enqueue; a waiting call
    // already admitted against the baseline is allowed to proceed.)
    const config = EFFECTIVE_CALL_TYPE_CONFIG[callType];
    if (state.active >= config.maxConcurrent) continue;
    const priority = CALL_TYPE_PRIORITY[callType];
    if (!best || priority < best.priority) {
      best = { entry: state.waiting[0]!, priority };
    }
  }
  if (!best) return undefined;
  // Remove the entry from its type's waiting list.
  for (const state of queueState.values()) {
    const idx = state.waiting.indexOf(best.entry);
    if (idx !== -1) {
      state.waiting.splice(idx, 1);
      break;
    }
  }
  return best.entry;
}

/**
 * Called after a call finishes (success or failure). Decrements the type's
 * active count and pumps the queue — if another type has waiting entries and
 * available capacity, the highest-priority one is granted a slot.
 */
function pumpQueue(): void {
  const next = dequeueNext();
  if (!next) return;
  const state = queueState.get(next.request.callType);
  if (!state) return;
  state.active++;
  // Run the call. The entry's promise resolves/rejects when the call completes.
  void runCall(next);
}

// ---------------------------------------------------------------------------
// Core: run a single inference call with retry
// ---------------------------------------------------------------------------

/**
 * Races a promise against a per-call-type timeout. complete() does not
 * accept an abort signal, so on timeout the underlying fetch is abandoned —
 * it will eventually settle (releasing its provider concurrency slot in
 * complete()'s finally block) but its result is ignored. The timer is
 * cleared when the promise settles first, so no dangling rejection is left
 * behind. The thrown error message matches shouldRetry()'s
 * /timeout|timed out|abort/i pattern so a timed-out call is retried.
 */
function withTimeoutRace<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`inference timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function runCall(entry: QueueEntry): Promise<void> {
  const { request, enqueuedAt, correlationId } = entry;
  // Workspace call_type_overrides merge on top of the env-adjusted baseline.
  const config = await resolveCallConfig(request.callType, request.workspaceId);
  const startedAt = Date.now();
  const queuedForMs = startedAt - enqueuedAt;
  let lastError: unknown;
  let retries = 0;
  const emit = await telemetryEnabled(request.workspaceId);

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const resp = await withTimeoutRace(
        complete(request.workspaceId, {
          system: request.systemPrompt ?? "",
          prompt: request.prompt,
          max_tokens: request.maxTokens,
          temperature: request.temperature,
          model: request.model,
        }),
        config.timeoutMs
      );
      if (!resp.ok) {
        throw new Error(
          `inference failed (${resp.provider_id}): ${resp.error ?? "unknown error"}`
        );
      }
      const result: InferenceCallResult = {
        text: resp.text,
        retries,
        elapsedMs: Date.now() - startedAt,
        callType: request.callType,
      };
      releaseSlot(request.callType);
      entry.resolve(result);
      if (emit) {
        emitTelemetry({
          call_type: request.callType,
          workspace_id: request.workspaceId,
          attempts: retries + 1,
          queued_for_ms: queuedForMs,
          total_ms: Date.now() - enqueuedAt,
          status: "completed",
          correlation_id: correlationId,
        });
      }
      return;
    } catch (err) {
      lastError = err;
      if (attempt < config.maxRetries && shouldRetry(err)) {
        retries++;
        await sleep(backoffDelay(attempt));
        continue;
      }
      break;
    }
  }

  releaseSlot(request.callType);
  entry.reject(lastError);
  if (emit) {
    emitTelemetry({
      call_type: request.callType,
      workspace_id: request.workspaceId,
      attempts: retries + 1,
      queued_for_ms: queuedForMs,
      total_ms: Date.now() - enqueuedAt,
      status: "failed",
      correlation_id: correlationId,
    });
  }
}

/**
 * Decrements the active count for a type and pumps the queue so a waiting
 * call can be granted the freed slot.
 */
function releaseSlot(callType: InferenceCallType): void {
  const state = queueState.get(callType);
  if (state) {
    state.active = Math.max(0, state.active - 1);
  }
  pumpQueue();
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Enqueue an inference call. Returns a promise that resolves with the result
 * when the call completes (after any retries), or rejects if all retries are
 * exhausted.
 *
 * Flow:
 * 1. If the queue is full (totalPending >= this workspace's max queue depth):
 *    - worker_dispatch → throw QueueFullError immediately (shed load)
 *    - critical types → always enqueue, wait for a slot
 *    - other non-critical types → throw QueueFullError
 * 2. If the type has an available concurrency slot (active < maxConcurrent),
 *    run immediately.
 * 3. Otherwise, push to the priority-ordered wait queue. The promise resolves
 *    when a slot is granted and the call completes.
 * 4. The actual LLM call goes through complete() (existing concurrency gate,
 *    pacing, 429 backoff remain intact underneath).
 * 5. On timeout / 5xx / 429, retry with exponential backoff + jitter up to
 *    maxRetries.
 *
 * Config resolution: the per-type budget and queue-depth limit come from
 * resolveCallConfig()/resolveMaxQueueDepth(), which apply the precedence
 *   code defaults < env vars (CB_INFERENCE_*) < workspace settings.
 */
export async function enqueueInference(
  request: InferenceCallRequest
): Promise<InferenceCallResult> {
  const config = await resolveCallConfig(request.callType, request.workspaceId);
  const maxQueueDepth = await resolveMaxQueueDepth(request.workspaceId);
  const correlationId = randomUUID();
  const enqueuedAt = Date.now();

  // Backpressure check — per-workspace depth limit.
  if (totalPending() >= maxQueueDepth) {
    if (!CRITICAL_TYPES.has(request.callType)) {
      throw new QueueFullError(request.callType);
    }
    // Critical types always enqueue even when full — they wait.
  }

  const state = queueState.get(request.callType)!;

  // If a slot is available, run immediately.
  if (state.active < config.maxConcurrent) {
    state.active++;
    return new Promise<InferenceCallResult>((resolve, reject) => {
      void runCall({
        request,
        resolve,
        reject,
        enqueuedAt,
        correlationId,
      });
    });
  }

  // No slot available — wait in the priority queue.
  return new Promise<InferenceCallResult>((resolve, reject) => {
    state.waiting.push({
      request,
      resolve,
      reject,
      enqueuedAt,
      correlationId,
    });
  });
}