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
export type ProviderKind = "hosted_api" | "harness_console" | "local_inference" | "olf_managed";

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

/** Token usage information from an inference call. */
export interface InferenceUsage {
  /** Tokens in the prompt. */
  prompt_tokens: number;
  /** Tokens in the completion. */
  completion_tokens: number;
  /** Total tokens (prompt + completion). */
  total_tokens: number;
}

/** A provider-agnostic inference response. */
export interface InferenceResponse {
  ok: boolean;
  text: string;
  provider_id: string;
  model: string;
  error?: string;
  /**
   * Token usage from the call, when available.
   * OLF Managed Inference and other OpenAI-compatible providers return this
   * in the standard `usage` block. Used for metering and display.
   */
  usage?: InferenceUsage;
}

/**
 * Read-only subscription state for an OLF Managed Inference subscription.
 *
 * Fetched from the OLF service's /subscription endpoint using the API key
 * (which IS the subscription identity — invariant 3: API key = identity).
 *
 * This is a read model: the board displays it but never modifies it.
 * Plan/tier/billing management happens at the OLF portal (invariant 5:
 * money/plan/tier = link-out), not here.
 *
 * When the OLF service is unreachable or the key is invalid, status is
 * "unknown" and the other fields are null — the board never blocks on
 * subscription display.
 */
export interface OlfSubscriptionState {
  /** Subscription status — "active" means inference is allowed. */
  status: "active" | "exhausted" | "suspended" | "unknown";
  /** Human-readable plan name (e.g. "Starter", "Collective"). Display only. */
  plan_name: string | null;
  /** Tokens used in the current billing period. */
  tokens_used: number | null;
  /** Token allowance for the current billing period. Null = unlimited. */
  token_limit: number | null;
  /** ISO 8601 timestamp when the current period resets. */
  period_end: string | null;
  /** URL of the OLF portal for subscription management (link-out target). */
  portal_url: string | null;
}

/** The common interface every provider adapter implements. */
export interface InferenceProvider {
  readonly kind: ProviderKind;
  readonly provider_id: string;
  complete(req: InferenceRequest): Promise<InferenceResponse>;
}

/** RBAC roles, carried from mother-board and exposed as operator settings. */
export type Role = "admin" | "operator" | "member" | "observer";

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
  updated_at: string;
}
