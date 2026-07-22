# Inference Queuing Architecture — Implementation Summary

This document summarizes [`inference-queuing-architecture.md`](commons-board/planning/inference-queuing-architecture.md) and cross-references the existing code that will be modified.

---

## 1. Components to Be Built

### New file: `inference-queue.ts`

Path: [`commons-board/services/api/src/lib/inference-queue.ts`](commons-board/services/api/src/lib/inference-queue.ts)

Exports:

- **`InferenceCallType`** (type union) — `"chair_deliberation" | "chair_summarize" | "task_extraction" | "worker_dispatch" | "board_synthesis"`
- **`CALL_TYPE_PRIORITY`** (`Record<InferenceCallType, number>`) — priority map: chair_deliberation=0, chair_summarize=1, task_extraction=2, board_synthesis=3, worker_dispatch=4 (lower = higher priority)
- **`CallTypeConfig`** (interface) — `maxConcurrent`, `timeoutMs`, `maxRetries`, `backoffBaseMs`, `backoffMaxMs`
- **`DEFAULT_CALL_TYPE_CONFIG`** (`Record<InferenceCallType, CallTypeConfig>`) — default per-type budgets
- **`InferenceCallRequest`** (interface) — `workspaceId`, `system`, `prompt`, `options?`, `callType`
- **`InferenceCallResult`** (interface) — `text`, `thinking`, `model`, `attempts`, `queuedForMs`
- **`enqueueInference(req: InferenceCallRequest): Promise<InferenceCallResult>`** — single entry point
- **`QueueFullError`** (class) — thrown when backpressure sheds a non-critical call
- **`shouldRetry(error, callType): boolean`** — retries on timeout/abort, 5xx, and 429
- **`backoffDelay(attempt, config): number`** — exponential backoff with 0–30% jitter

Internal mechanisms:
- Priority scheduler (picks highest-priority waiting call; FIFO within same priority)
- Per-type concurrency budget (independent of provider's global `maxParallel`)
- Retry controller (exponential backoff with jitter on timeout/5xx)
- Backpressure shedding (non-critical types shed when queue depth > `MAX_QUEUE_DEPTH`)

### New function: `summarizeChairResponse`

Added to [`chair-reasoning.ts`](commons-board/services/api/src/services/chair-reasoning.ts) (or a new `chair-summarizer.ts`):

```typescript
export async function summarizeChairResponse(input: {
  workspaceId: string;
  chairId: string;
  chairName: string;
  domain: BoardDomain;
  responseText: string;
  model?: string;
}): Promise<string>
```

Summarizes each chair's full response into ~200 words of actionable items before task extraction. Routes through `enqueueInference()` with `callType: "chair_summarize"`.

### New interface: `InferenceQueueSettings`

Added to shared types (`WorkspaceSettings.inference_queue`):

```typescript
export interface InferenceQueueSettings {
  call_type_overrides?: Partial<Record<InferenceCallType, Partial<CallTypeConfig>>>;
  max_queue_depth?: number;
  enable_telemetry?: boolean;
}
```

---

## 2. Phased Implementation Plan

### Phase 1 — Inference queue core + chair restructuring

**Goal**: Build the queue, route chair deliberation through it, fix over-extension.

**Create**: `inference-queue.ts` (full queue: `enqueueInference()`, types, config, `QueueFullError`, priority scheduler, per-type budget, retry with backoff)

**Modify**:
- [`chair-reasoning.ts`](commons-board/services/api/src/services/chair-reasoning.ts) — add `callType` to `ReasoningInput`, replace `completeTextWithThinking()` with `enqueueInference()`
- [`motherboard-chat.ts`](commons-board/services/api/src/routes/motherboard-chat.ts) — change `mapConcurrent` limit to `activeChairs.length`, pass `callType: "chair_deliberation"`

**Verify**: 6-chair chat shows only 2 concurrent; chair timeout retries twice; prose-only flow still works.

**Out of scope**: summarization, task extraction routing, worker dispatch, synthesis routing, backpressure.

### Phase 2 — Task extraction optimization + all call types routed

**Goal**: Add chair summarization, route task extraction and synthesis through queue, fix extraction timeout.

**Modify**:
- [`chair-reasoning.ts`](commons-board/services/api/src/services/chair-reasoning.ts) — add `summarizeChairResponse()`
- [`task-extractor.ts`](commons-board/services/api/src/services/task-extractor.ts) — replace `completeText()` with `enqueueInference()` at `callType: "task_extraction"`, use `response_summary` in prompt
- [`board-synthesizer.ts`](commons-board/services/api/src/services/board-synthesizer.ts) — replace `completeText()` with `enqueueInference()` at `callType: "board_synthesis"`
- [`motherboard-chat.ts`](commons-board/services/api/src/routes/motherboard-chat.ts) — add summarization step before extraction, pass `response_summary` to extractor
- [`delegation-types.ts`](commons-board/services/api/src/services/delegation-types.ts) — add `response_summary?: string` to `DelegationChairResponse`

**Verify**: previously-timing-out extraction now succeeds via summarize-then-extract; fallback to full text on summary failure; synthesis retries before template fallback.

**Out of scope**: worker dispatch routing, backpressure.

### Phase 3 — Worker dispatch routing + backpressure

**Goal**: Route worker calls through queue, add backpressure shedding.

**Modify**:
- [`delegation-dispatcher.ts`](commons-board/services/api/src/services/delegation-dispatcher.ts) — replace `completeText()` with `enqueueInference()` at `callType: "worker_dispatch"`, remove `withTimeout()`, catch `QueueFullError`
- [`inference-queue.ts`](commons-board/services/api/src/lib/inference-queue.ts) — implement backpressure shedding for non-critical types when depth > `MAX_QUEUE_DEPTH`

**Verify**: 10+ task batch runs 3 at a time; excess tasks marked `skipped`; worker calls retry on timeout; large batch doesn't starve synthesis.

### Phase 4 — Configuration + telemetry

**Goal**: Make settings configurable, add telemetry.

**Modify**:
- [`inference-queue.ts`](commons-board/services/api/src/lib/inference-queue.ts) — read `InferenceQueueSettings` from workspace settings, apply overrides, emit telemetry events
- Shared types — add `InferenceQueueSettings` to `WorkspaceSettings`
- [`env.ts`](commons-board/services/api/src/lib/env.ts) — add `CB_INFERENCE_*` env var support

**Verify**: override `chair_deliberation.maxConcurrent` to 3 via settings; telemetry logs `inference_call` events.

### Dependency graph

Phase 1 → Phase 2 → Phase 3 → Phase 4 (linear). Phase 1 is independently shippable.

---

## 3. Integration Points with Existing Code

| Call site | File | Current function | Queue call type | Priority | Changes |
|-----------|------|------------------|-----------------|----------|---------|
| Chair deliberation | [`chair-reasoning.ts:212`](commons-board/services/api/src/services/chair-reasoning.ts:212) | `completeTextWithThinking()` | `chair_deliberation` | 0 | Route through `enqueueInference()`, add `callType` to `ReasoningInput` |
| Chair summarization | new `summarizeChairResponse()` | n/a | `chair_summarize` | 1 | New function |
| Task extraction | [`task-extractor.ts:74`](commons-board/services/api/src/services/task-extractor.ts:74) | `completeText()` | `task_extraction` | 2 | Route through `enqueueInference()`, use `response_summary` |
| Worker dispatch | [`delegation-dispatcher.ts:206`](commons-board/services/api/src/services/delegation-dispatcher.ts:206) | `completeText()` | `worker_dispatch` | 4 | Route through `enqueueInference()`, remove `withTimeout()`, catch `QueueFullError` |
| Board synthesis | [`board-synthesizer.ts:114`](commons-board/services/api/src/services/board-synthesizer.ts:114) | `completeText()` | `board_synthesis` | 3 | Route through `enqueueInference()` |

### Files to create
- [`inference-queue.ts`](commons-board/services/api/src/lib/inference-queue.ts)

### Files to modify
| File | Change |
|------|--------|
| [`chair-reasoning.ts`](commons-board/services/api/src/services/chair-reasoning.ts) | Add `callType` to `ReasoningInput`, replace `completeTextWithThinking()` with `enqueueInference()`, add `summarizeChairResponse()` |
| [`task-extractor.ts`](commons-board/services/api/src/services/task-extractor.ts) | Replace `completeText()` with `enqueueInference()`, use `response_summary` in prompt |
| [`delegation-dispatcher.ts`](commons-board/services/api/src/services/delegation-dispatcher.ts) | Replace `completeText()` with `enqueueInference()`, remove `withTimeout()`, catch `QueueFullError` |
| [`board-synthesizer.ts`](commons-board/services/api/src/services/board-synthesizer.ts) | Replace `completeText()` with `enqueueInference()` |
| [`motherboard-chat.ts`](commons-board/services/api/src/routes/motherboard-chat.ts) | Change `mapConcurrent` limit to `activeChairs.length`, add summarization step, pass `callType` |
| [`delegation-types.ts`](commons-board/services/api/src/services/delegation-types.ts) | Add `response_summary?: string` to `DelegationChairResponse` |

### What does NOT change
- [`complete()`](commons-board/services/api/src/lib/model-client.ts:96) — concurrency gate, pacing, 429 backoff remain intact underneath the queue
- [`hosted-api.ts`](commons-board/services/api/src/lib/provider/hosted-api.ts) — provider adapter unchanged; 240s `AbortSignal.timeout` is the hard floor
- [`getProviderConcurrency()`](commons-board/services/api/src/lib/model-client.ts:152) — still used for wave sizing, but queue controls actual concurrency
- [`mapConcurrent()`](commons-board/services/api/src/lib/model-client.ts:169) — still used; `limit` now controls enqueue rate, not inference concurrency

---

## 4. Configuration Options

### Per-type defaults (in code: `DEFAULT_CALL_TYPE_CONFIG`)

| Call type | maxConcurrent | timeoutMs | maxRetries | backoffBaseMs | backoffMaxMs |
|-----------|--------------|-----------|------------|---------------|--------------|
| chair_deliberation | 2 | 180,000 (3 min) | 2 | 4,000 | 30,000 |
| chair_summarize | 3 | 60,000 | 2 | 3,000 | 20,000 |
| task_extraction | 1 | 120,000 | 2 | 4,000 | 30,000 |
| worker_dispatch | 3 | 120,000 | 1 | 5,000 | 30,000 |
| board_synthesis | 1 | 120,000 | 2 | 4,000 | 30,000 |

### Workspace-level (`InferenceQueueSettings` in `WorkspaceSettings.inference_queue`)
- `call_type_overrides` — partial per-type config overrides
- `max_queue_depth` — default 20
- `enable_telemetry` — default false

### Environment-level (`CB_INFERENCE_*` env vars)
- `CB_INFERENCE_MAX_QUEUE_DEPTH` — override global queue depth
- `CB_INFERENCE_CHAIR_MAX_CONCURRENT` — override chair concurrency
- `CB_INFERENCE_WORKER_TIMEOUT_MS` — override worker timeout

Precedence: env vars override code defaults; workspace settings override env vars.

### Telemetry
When `enable_telemetry` is true, logs JSON events: `event`, `call_type`, `workspace_id`, `attempts`, `queued_for_ms`, `total_ms`, `status`, `correlation_id`. Goes to console, NOT the decision log.

---

## 5. Code Patterns and Interfaces Defined

### `enqueueInference()` flow
1. Tag call with `callType` and priority
2. Wait for per-type concurrency slot (bounded by `maxConcurrent`)
3. Wait for turn in priority scheduler (if other types waiting)
4. Call `complete()` (existing global gate + pacing + 429 backoff)
5. On timeout/5xx, retry with exponential backoff up to `maxRetries`
6. Return result with telemetry (`attempts`, `queuedForMs`)

### Retry logic
```typescript
function shouldRetry(error: string | undefined, callType: InferenceCallType): boolean {
  if (!error) return false;
  if (/timeout|timed out|abort/i.test(error)) return true;
  if (/\b5\d\d\b/.test(error)) return true;
  if (/\b429\b/.test(error)) return true;
  return false;
}
```

### Backoff with jitter
```typescript
function backoffDelay(attempt: number, config: CallTypeConfig): number {
  const base = config.backoffBaseMs * Math.pow(2, attempt);
  const capped = Math.min(base, config.backoffMaxMs);
  const jitter = Math.random() * 0.3 * capped;
  return capped + jitter;
}
```

### Backpressure
- `MAX_QUEUE_DEPTH` default: 20
- Critical types (`chair_deliberation`, `board_synthesis`): always enqueued, never shed
- Non-critical (`worker_dispatch`): shed with `QueueFullError` when depth exceeded; dispatcher catches and marks task `status: "skipped"` with `error: "inference queue at capacity"`

### Per-chair restructuring pattern
`mapConcurrent` limit set to `activeChairs.length` (all enqueue immediately); queue's per-type budget controls actual concurrency. Preserves progressive UI reveal via `appendChairResult()`.

### Summarize-then-extract pattern
Each chair response summarized to ~200 words before extraction. Extractor uses `response_summary ?? response_text` (fallback). Full responses still go to `synthesizeBoardResponse()`.

---

## 6. Existing Code Context

### `model-client.ts` — the concurrency gate (unchanged)
- [`complete()`](commons-board/services/api/src/lib/model-client.ts:96) — keyed by `provider_id`, enforces `maxParallel = floor(lanes/cost)`, `MIN_CALL_SPACING_MS` (1500ms) pacing, 429 backoff `[2000, 4000, 8000, 16000]`ms
- [`getProviderConcurrency()`](commons-board/services/api/src/lib/model-client.ts:152) — returns `{lanes, cost, maxParallel}`
- [`mapConcurrent()`](commons-board/services/api/src/lib/model-client.ts:169) — Promise.all with concurrency limit
- [`completeText()`](commons-board/services/api/src/lib/model-client.ts:201) — strips thinking, returns answer only
- [`completeTextWithThinking()`](commons-board/services/api/src/lib/model-client.ts:243) — returns `{thinking, answer}` separately
- [`completeChat()`](commons-board/services/api/src/lib/model-client.ts:221) — multi-turn with history

### `chair-reasoning.ts` — chair deliberation
- [`buildReasonedBoardResponse()`](commons-board/services/api/src/services/chair-reasoning.ts:143) — builds domain-specific system prompt, calls `completeTextWithThinking()` at line 212, falls back to template on `NoProviderConfiguredError`
- `ReasoningInput` type (line 18) — needs `callType?` field added

### `task-extractor.ts` — extraction that times out
- [`extractDelegatableTasks()`](commons-board/services/api/src/services/task-extractor.ts:57) — single `completeText()` call at line 74 with all chair responses + worker list; returns `[]` on any failure
- [`buildExtractorUserPrompt()`](commons-board/services/api/src/services/task-extractor.ts:136) — uses `c.response_text` (full prose); needs `response_summary ?? response_text`

### `delegation-dispatcher.ts` — worker dispatch
- [`dispatchTasks()`](commons-board/services/api/src/services/delegation-dispatcher.ts:49) — topological wave execution with `mapConcurrent` + `getProviderConcurrency`
- [`executeTaskInline()`](commons-board/services/api/src/services/delegation-dispatcher.ts:168) — calls `completeText()` at line 206 wrapped in `withTimeout()`; catches errors → `failed` deliverable
- [`withTimeout()`](commons-board/services/api/src/services/delegation-dispatcher.ts:311) — to be removed (queue handles timeout)

### `board-synthesizer.ts` — board synthesis
- [`synthesizeBoardResponse()`](commons-board/services/api/src/services/board-synthesizer.ts:35) — calls `completeText()` at line 114; falls back to template synthesis in catch block (line 139)

### `motherboard-chat.ts` — main chat flow
- [`executeBoardChat()`](commons-board/services/api/src/routes/motherboard-chat.ts:58) — orchestrates: interpret → chairs via `mapConcurrent` (line 163) → delegation → synthesis
- Line 161: `getProviderConcurrency()` → `maxParallel` used as `mapConcurrent` limit
- Line 272-277: builds `chairResponses` for extractor (needs `response_summary` added)
- Line 279: `extractDelegatableTasks()` call
- Line 290: `dispatchTasks()` call
- Line 328: `synthesizeBoardResponse()` call