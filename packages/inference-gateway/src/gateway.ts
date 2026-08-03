/**
 * InferenceGateway — the multi-tenant control plane over Foundry MaaS.
 *
 * This is where the five load-bearing invariants (design brief §4) are
 * enforced. The gateway sits between the tenant's inference request and the
 * fulfillment backend (hosted Foundry or self-hosted). Every call passes
 * through here, so every invariant is checked here — not at the backend, not
 * at the application layer, not reconstructed after the fact.
 *
 * The enforcement order matters and is deliberate:
 *
 *   1. Subscription check (invariant #2) — before anything else. No billing
 *      relationship, no inference. Full stop.
 *   2. Pre-call ceiling check (invariant #1) — refuse before the token is
 *      spent, not after. If tokens_consumed + estimated cost > ceiling, the
 *      call never reaches the backend.
 *   3. Fulfillment — the backend serves the request.
 *   4. Version-pin validation (§9) — the served version must satisfy the
 *      artifact's declared pin. A silent MaaS version update is caught here.
 *   5. Post-call metering (invariant #5) — record actual consumption. If the
 *      call exceeded the declared cost, flag it for drift monitoring (§7).
 *
 * The pre-call check uses the declared expected cost as the estimate. This is
 * the upstream attribution (invariant #4): the need was bound to the tenant
 * by the artifact's declaration, and the cost was authorized in advance by
 * the ceiling check. Nothing is reconstructed.
 */
import type {
  TenantProvisioning,
  MeteringRecord,
  FulfillmentRequest,
  FulfillmentResult,
  FulfillmentBackend,
  InferenceNeed,
} from "./types.js";
import {
  TokenCeilingExceededError,
  NoActiveSubscriptionError,
  VersionPinViolationError,
} from "./types.js";

export type GatewayConfig = {
  /**
   * Safety margin applied to the declared expected cost when doing the
   * pre-call ceiling check. The pre-call estimate is:
   *   declared_expected_tokens * (1 + pre_call_margin)
   * This ensures the pre-call check is conservative — better to refuse a
   * call that would have fit than to let one through that blows the ceiling.
   * Defaults to 0.1 (10% margin).
   */
  pre_call_margin?: number;
};

export type GatewayDeps = {
  /** Looks up tenant provisioning by tenant_id. Returns null if not provisioned. */
  getTenant: (tenant_id: string) => TenantProvisioning | null;
  /** Persists updated token consumption after a call. */
  updateConsumption: (tenant_id: string, tokens_consumed: number) => void;
  /** Records a metering event for billing and drift monitoring. */
  recordMetering: (record: MeteringRecord) => void;
};

export type GatewayCallParams = {
  tenant_id: string;
  artifact_id: string;
  request: FulfillmentRequest;
};

export type GatewayCallResult = FulfillmentResult & {
  metering: MeteringRecord;
};

export class InferenceGateway {
  private readonly deps: GatewayDeps;
  private readonly config: Required<GatewayConfig>;

  constructor(deps: GatewayDeps, config?: GatewayConfig) {
    this.deps = deps;
    this.config = {
      pre_call_margin: config?.pre_call_margin ?? 0.1,
    };
  }

  /**
   * Routes a declared inference need through the gateway, enforcing all five
   * invariants. The fulfillment backend is provided by the caller (the
   * routing layer resolves hosted-vs-self-hosted — §5).
   *
   * Throws:
   *   - NoActiveSubscriptionError (invariant #2)
   *   - TokenCeilingExceededError (invariant #1)
   *   - VersionPinViolationError (§9)
   */
  async call(
    backend: FulfillmentBackend,
    params: GatewayCallParams,
  ): Promise<GatewayCallResult> {
    const { tenant_id, artifact_id, request } = params;
    const need = request.need;

    // ── Invariant #2: every managed/hosted need requires an active subscription ──
    const tenant = this.deps.getTenant(tenant_id);
    if (!tenant) {
      throw new NoActiveSubscriptionError(tenant_id);
    }
    if (tenant.subscription_status !== "active") {
      throw new NoActiveSubscriptionError(tenant_id);
    }

    // ── Invariant #1: pre-call ceiling check (refuse before spend) ──
    // The pre-call estimate uses the declared expected cost plus a safety
    // margin. This is conservative: if the declared cost is accurate, the
    // call fits; if it under-discloses (§7 drift), the margin absorbs small
    // drift and the post-call metering catches large drift.
    const preCallEstimate = Math.ceil(
      need.disclosed_cost.expected_tokens_per_call * (1 + this.config.pre_call_margin),
    );
    if (tenant.tokens_consumed + preCallEstimate > tenant.token_ceiling) {
      throw new TokenCeilingExceededError(
        tenant_id,
        tenant.tokens_consumed,
        tenant.token_ceiling,
      );
    }

    // ── Fulfillment (§5: hosted or self-hosted, same interface) ──
    const result = await backend.fulfill(request);

    if (!result.ok) {
      // Backend failed — no tokens consumed, no metering record.
      // The error is propagated; the tenant's ceiling is not charged.
      return { ...result, metering: this.buildFailedMetering(tenant_id, artifact_id, need, result) };
    }

    // ── §9: version-pin validation ──
    // The served version must satisfy the artifact's declared pin. This is
    // where a silent MaaS version update is caught — it becomes an event,
    // not silent drift.
    this.validateVersionPin(need, result.model_version_served);

    // ── Invariant #5: post-call metering ──
    const totalTokens = result.input_tokens + result.output_tokens;
    const exceededDeclared = totalTokens > need.disclosed_cost.expected_tokens_per_call;

    const metering: MeteringRecord = {
      tenant_id,
      call_id: crypto.randomUUID(),
      artifact_id,
      determination_type: need.determination_type,
      model_class: need.model_class,
      model_version_served: result.model_version_served,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      total_tokens: totalTokens,
      declared_expected_tokens: need.disclosed_cost.expected_tokens_per_call,
      exceeded_declared_cost: exceededDeclared,
      timestamp: new Date().toISOString(),
    };

    // Update consumption and record metering.
    const newConsumed = tenant.tokens_consumed + totalTokens;
    this.deps.updateConsumption(tenant_id, newConsumed);
    this.deps.recordMetering(metering);

    return { ...result, metering };
  }

  /**
   * Validates that the served model version satisfies the artifact's declared
   * version pin (§9). Throws VersionPinViolationError if the pin is violated.
   *
   * Pin policies:
   *   - "exact": served must equal declared (default — determinism-critical)
   *   - "minor": served must share major.minor with declared
   *   - "any":   no enforcement (advisory only)
   */
  private validateVersionPin(need: InferenceNeed, servedVersion: string): void {
    const policy = need.version_pin.pin_policy ?? "exact";
    const declared = need.version_pin.declared_version;

    if (policy === "any") {
      return;
    }

    if (policy === "exact") {
      if (servedVersion !== declared) {
        throw new VersionPinViolationError(declared, servedVersion, policy);
      }
      return;
    }

    // "minor": match major.minor segments.
    // Splits on "." and compares the first two segments. If either version
    // has fewer than two segments, falls back to exact match on what exists.
    const declaredParts = declared.split(".");
    const servedParts = servedVersion.split(".");
    const declaredMinor = declaredParts.slice(0, 2).join(".");
    const servedMinor = servedParts.slice(0, 2).join(".");
    if (declaredMinor !== servedMinor) {
      throw new VersionPinViolationError(declared, servedVersion, policy);
    }
  }

  private buildFailedMetering(
    tenant_id: string,
    artifact_id: string,
    need: InferenceNeed,
    result: FulfillmentResult,
  ): MeteringRecord {
    return {
      tenant_id,
      call_id: crypto.randomUUID(),
      artifact_id,
      determination_type: need.determination_type,
      model_class: need.model_class,
      model_version_served: result.model_version_served,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      declared_expected_tokens: need.disclosed_cost.expected_tokens_per_call,
      exceeded_declared_cost: false,
      timestamp: new Date().toISOString(),
    };
  }
}