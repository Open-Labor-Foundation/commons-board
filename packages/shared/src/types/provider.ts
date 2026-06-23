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
 * Provider configuration as stored in settings. Note: this references *where* a
 * credential comes from (an env var name), never the credential itself.
 */
export interface ProviderConfig {
  provider_id: string;
  kind: ProviderKind;
  display_name: string;
  model: string;
  /** Name of the env var holding the API key — resolved at runtime, never stored. */
  api_key_env: string | null;
  /** Endpoint or base URL for hosted/harness providers; null for local. */
  endpoint: string | null;
  /** Free-form adapter options (timeouts, lane count, local model path, etc.). */
  options: Record<string, string | number | boolean>;
}

/** A single inference request, provider-agnostic. */
export interface InferenceRequest {
  system: string;
  prompt: string;
  max_tokens?: number;
  temperature?: number;
  correlation_id?: string;
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
  updated_at: string;
}
