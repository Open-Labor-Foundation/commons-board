/**
 * Core types for the OLF Managed Inference gateway (design brief §4, §5, §8).
 *
 * The gateway is the multi-tenant control plane over Foundry MaaS. It enforces
 * the five load-bearing invariants that prevent the featherless failure mode:
 *
 *   1. No fixed-cost inference without a gateway-enforced token ceiling.
 *   2. Every managed/hosted need requires an active SMB subscription.
 *   3. Artifacts disclose both need and cost.
 *   4. Provisioning binds need to tenant before spend.
 *   5. Overage is metered above cost; breakage is margin.
 *
 * These types are the contract the gateway implementation and its tests operate
 * on. They are deliberately separate from commons-crew's ProviderCapabilities
 * (transport surface) and from the governance ledger's provenance (observation
 * surface) -- see the design brief §5 for why these axes must not collapse.
 */

// ── InferenceNeed (mirrors artifact-commons/schemas/inference-need.schema.json) ──

export type DeterminationType = "chat" | "planning" | "execution" | "synthesis";

export type InferenceNeed = {
  determination_type: DeterminationType;
  model_class: string;
  context: {
    min_tokens: number;
    typical_input_tokens?: number;
    typical_output_tokens?: number;
  };
  version_pin: {
    declared_version: string;
    pin_policy?: "exact" | "minor" | "any";
  };
  disclosed_cost: {
    expected_tokens_per_call: number;
    basis: "measured" | "estimated" | "upper_bound";
    measured_at?: string;
  };
  drift_reconciliation?: {
    threshold_ratio: number;
    action_on_drift?: "flag_for_recost" | "block_until_recost" | "downgrade_to_estimated";
  };
};

// ── Tenant provisioning (invariant #2, #4) ──────────────────────────────────

/**
 * A provisioned tenant. Provisioning IS the attribution (invariant #4): the
 * need is bound to a tenant before the token is spent, because the artifact
 * declared it and provisioning authorized it. Cost is authorized in advance,
 * not forensically reassembled.
 *
 * Invariant #2: no inference without a billing relationship. An active
 * subscription is required before a tenant can be provisioned.
 */
export type TenantProvisioning = {
  tenant_id: string;
  subscription_id: string;
  subscription_status: "active" | "suspended" | "cancelled";
  /** Hard token ceiling for the current billing period (invariant #1). */
  token_ceiling: number;
  /** Tokens consumed so far in the current billing period. */
  tokens_consumed: number;
  /** Per-tenant API key issued by the gateway (never the raw Foundry key). */
  gateway_api_key: string;
  /** ISO timestamp of the current billing period start. */
  period_start: string;
  /** ISO timestamp of the current billing period end. */
  period_end: string;
};

// ── Metering (invariant #5, §8) ─────────────────────────────────────────────

/**
 * A metering record for a single inference call. Per-tenant token counts
 * aggregated for billing; this is the upstream attribution that featherless
 * had to reconstruct after the fact.
 */
export type MeteringRecord = {
  tenant_id: string;
  call_id: string;
  artifact_id: string;
  determination_type: DeterminationType;
  model_class: string;
  model_version_served: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  /** The declared expected cost from the artifact's InferenceNeed. */
  declared_expected_tokens: number;
  /** Whether this call exceeded the declared cost (drift signal, §7). */
  exceeded_declared_cost: boolean;
  timestamp: string;
};

// ── Fulfillment (§5 — hosted vs self-hosted is a routing decision) ──────────

/**
 * The fulfillment interface. Either a managed Foundry backend OR a customer
 * self-hosted endpoint satisfies this. The artifact's InferenceNeed does not
 * change; only the fulfillment does. This is what allows both offerings from
 * one codebase.
 */
export type FulfillmentResult = {
  ok: boolean;
  text: string;
  model_version_served: string;
  input_tokens: number;
  output_tokens: number;
  error?: string;
};

export type FulfillmentRequest = {
  system: string;
  prompt: string;
  need: InferenceNeed;
  max_tokens?: number;
  temperature?: number;
};

/**
 * A fulfillment backend — hosted (Foundry MaaS) or self-hosted (customer
 * endpoint). Both implement the same interface so the router treats them
 * identically.
 */
export interface FulfillmentBackend {
  readonly kind: "hosted" | "self_hosted";
  readonly backend_id: string;
  fulfill(req: FulfillmentRequest): Promise<FulfillmentResult>;
}

// ── Gateway errors ──────────────────────────────────────────────────────────

/**
 * Thrown when a tenant's token ceiling is reached (invariant #1). The gateway
 * refuses the (N+1)th token — no advisory caps, no honor system, no soft
 * limits. An advisory cap IS the featherless exposure.
 */
export class TokenCeilingExceededError extends Error {
  readonly tenant_id: string;
  readonly tokens_consumed: number;
  readonly token_ceiling: number;
  constructor(tenant_id: string, tokens_consumed: number, token_ceiling: number) {
    super(`Tenant ${tenant_id} has consumed ${tokens_consumed}/${token_ceiling} tokens — ceiling reached (invariant #1). The (N+1)th token is refused.`);
    this.name = "TokenCeilingExceededError";
    this.tenant_id = tenant_id;
    this.tokens_consumed = tokens_consumed;
    this.token_ceiling = token_ceiling;
  }
}

/**
 * Thrown when no active subscription exists (invariant #2). No inference
 * without a billing relationship behind it.
 */
export class NoActiveSubscriptionError extends Error {
  readonly tenant_id: string;
  constructor(tenant_id: string) {
    super(`Tenant ${tenant_id} has no active subscription — managed inference requires a billing relationship (invariant #2).`);
    this.name = "NoActiveSubscriptionError";
    this.tenant_id = tenant_id;
  }
}

/**
 * Thrown when the served model version does not satisfy the artifact's
 * version pin (§9). A managed endpoint must not quietly undermine the
 * ledger's immutability guarantee.
 */
export class VersionPinViolationError extends Error {
  readonly declared_version: string;
  readonly served_version: string;
  readonly pin_policy: string;
  constructor(declared_version: string, served_version: string, pin_policy: string) {
    super(`Version pin violation: artifact requires "${declared_version}" (policy: ${pin_policy}) but backend served "${served_version}" (§9 determinism).`);
    this.name = "VersionPinViolationError";
    this.declared_version = declared_version;
    this.served_version = served_version;
    this.pin_policy = pin_policy;
  }
}