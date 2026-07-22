/**
 * Inference provider and settings types.
 *
 * commons-board reasons through configurable providers chosen in a settings
 * menu, not hardcoded. Adapters and config shape live in-repo; credentials are
 * deployment-specific settings injected at runtime and NEVER committed.
 *
 * See planning/architecture.md (Provider & Settings Subsystem).
 */

/** Implementation styles a provider adapter can take. */
export type ProviderKind = "hosted_api" | "harness_console" | "local_inference";

/**
 * Provider configuration as stored in workspace settings.
 * api_key is stored directly (user-supplied via UI, encrypted at rest by the OS/filesystem).
 * api_key_env is retained as a fallback for advanced/production deployments that inject keys via env.
 */
export interface ProviderConfig {
  provider_id: string;
  kind: ProviderKind;
  display_name: string;
  model: string;
  /** The API key entered by the user. Stored in workspace settings. Takes precedence over api_key_env. */
  api_key?: string | null;
  /** Name of an env var holding the API key — fallback when api_key is not set. */
  api_key_env?: string | null;
  /** Endpoint or base URL for hosted/harness providers; null for local. */
  endpoint: string | null;
  /** Free-form adapter options (timeouts, local model path, etc.). */
  options: Record<string, string | number | boolean>;
  /**
   * Total concurrent inference lanes available on this API key.
   * Featherless bills by concurrency — set this to your key's lane allotment.
   * Defaults to 1 when unset (safe, conservative).
   */
  concurrency_lanes?: number;
  /**
   * Number of lanes a single inference call consumes for the configured model.
   * Featherless charges differently per model size (e.g. 7B = 1 lane, 70B = 3 lanes).
   * Defaults to 1 when unset.
   */
  concurrency_cost?: number;
}

/** A single inference request, provider-agnostic. */
export interface InferenceRequest {
  system: string;
  prompt: string;
  max_tokens?: number;
  temperature?: number;
  correlation_id?: string;
  /** Per-call model override — takes precedence over ProviderConfig.model. */
  model?: string;
  /** Prior conversation turns for multi-turn sessions (user/assistant alternating). */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

/** A provider-agnostic inference response. */
export interface InferenceResponse {
  ok: boolean;
  text: string;
  provider_id: string;
  model: string;
  error?: string;
}

/** The common interface every provider adapter implements. */
export interface InferenceProvider {
  readonly kind: ProviderKind;
  readonly provider_id: string;
  complete(req: InferenceRequest): Promise<InferenceResponse>;
}

/** RBAC roles, carried from mother-board and exposed as operator settings. */
export type Role = "admin" | "operator" | "member" | "observer";

/**
 * Call types the inference queue tags each request with. Used for per-type
 * concurrency budgets, priority scheduling, and backpressure shedding.
 *
 * Defined here (in the shared package) rather than in inference-queue.ts so
 * that WorkspaceSettings.inference_queue can reference it without the shared
 * package importing from the API service. inference-queue.ts re-exports these.
 */
export type InferenceCallType =
  | "chair_deliberation"
  | "chair_summarize"
  | "task_extraction"
  | "board_synthesis"
  | "worker_dispatch";

/**
 * Per-call-type budget. The queue keeps an independent concurrency budget per
 * type (separate from the provider's global maxParallel). Partial overrides
 * merge on top of the code defaults, so every field is optional here.
 */
export interface CallTypeConfig {
  maxConcurrent: number;
  timeoutMs: number;
  maxRetries: number;
}

/**
 * Workspace-level overrides for the inference queue. Stored under
 * WorkspaceSettings.inference_queue. Precedence (low → high):
 *   code defaults < env vars (CB_INFERENCE_*) < these workspace settings.
 */
export interface InferenceQueueSettings {
  /** Partial per-type config overrides; merged on top of the env-adjusted defaults. */
  call_type_overrides?: Partial<Record<InferenceCallType, Partial<CallTypeConfig>>>;
  /** Override the global queue-depth backpressure limit for this workspace. */
  max_queue_depth?: number;
  /** When true, emit JSON telemetry events to console after each call. */
  enable_telemetry?: boolean;
}

/** Per-workspace settings, surfaced in the settings menu. */
export interface WorkspaceSettings {
  workspace_id: string;
  org_name?: string;
  governance_mode?: "collective" | "business";
  active_provider_id: string;
  providers: ProviderConfig[];
  rbac: {
    /** Map of role -> granted capability keys. */
    grants: Record<Role, string[]>;
  };
  feature_toggles: Record<string, boolean>;
  board_settings?: {
    /** Minimum intent confidence for the reasoning loop to pass. Below this, board chat is blocked. Default 0.45. */
    confidence_floor?: number;
  };
  /** URL of the add-in catalog JSON. Overrides ADDINS_CATALOG_URL env var. */
  addin_catalog_url?: string;
  /** Inference queue tuning (concurrency budgets, queue depth, telemetry). */
  inference_queue?: InferenceQueueSettings;
  updated_at: string;
}
