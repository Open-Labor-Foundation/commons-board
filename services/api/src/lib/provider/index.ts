/**
 * Inference provider registry. Locks the contract every adapter implements and
 * selects the active provider from workspace settings.
 *
 * Adapters (hosted-api, harness-console, local-inference) register themselves
 * here. Credentials are resolved at call time from the env var named in
 * ProviderConfig.api_key_env — never stored in settings or the repo.
 */
import type {
  InferenceProvider,
  ProviderConfig,
  ProviderKind
} from "@commons-board/shared";

export type ProviderFactory = (config: ProviderConfig) => InferenceProvider;

const factories = new Map<ProviderKind, ProviderFactory>();

/** Register an adapter factory for a provider kind. Called by each adapter module. */
export function registerProvider(kind: ProviderKind, factory: ProviderFactory): void {
  factories.set(kind, factory);
}

export function isProviderKindRegistered(kind: ProviderKind): boolean {
  return factories.has(kind);
}

/** Instantiate a provider from its config. Throws if no adapter is registered. */
export function createProvider(config: ProviderConfig): InferenceProvider {
  const factory = factories.get(config.kind);
  if (!factory) {
    throw new Error(
      `no inference adapter registered for provider kind "${config.kind}" (provider_id=${config.provider_id})`
    );
  }
  return factory(config);
}

/** Resolve a deployment-injected credential by env var name. Never logged. */
export function resolveApiKey(config: ProviderConfig): string | null {
  if (!config.api_key_env) return null;
  const value = process.env[config.api_key_env];
  return value && value.trim() !== "" ? value : null;
}

export type { InferenceProvider, ProviderConfig, ProviderKind };
