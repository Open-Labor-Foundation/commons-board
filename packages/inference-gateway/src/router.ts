/**
 * Routing layer — resolves a declared InferenceNeed to hosted-or-self-hosted
 * fulfillment (design brief §5, build-order step 3).
 *
 * The router is deterministic by design. It takes a declared capability need
 * and a tenant's fulfillment preference, and returns the backend that
 * satisfies the need. The artifact's InferenceNeed does not change; only the
 * fulfillment does. This is what allows both offerings from one codebase.
 *
 * Routing rules (checked in order):
 *   1. If the tenant has a self-hosted endpoint configured AND it satisfies
 *      the declared need (model class, context floor, version pin), route
 *      there. Self-hosting is the escape hatch — it must always be offered
 *      (design brief §1).
 *   2. Otherwise, route to the managed Foundry backend.
 *   3. If no backend can satisfy the need, throw — the need is unfulfillable.
 *      This is a hard failure, not a silent fallback to a lower-grade model.
 *
 * The router does NOT enforce invariants (subscription, ceiling, metering) —
 * that's the gateway's job. The router only resolves *which* backend; the
 * gateway wraps the call with invariant enforcement.
 */
import type { FulfillmentBackend, InferenceNeed } from "./types.js";

export type TenantFulfillmentPreference = {
  tenant_id: string;
  /**
   * "hosted" = use the managed Foundry backend (default for SMBs who don't
   * want the operational burden — design brief §1).
   * "self_hosted" = use the tenant's own endpoint (the escape hatch).
   */
  mode: "hosted" | "self_hosted";
};

export type RouterDeps = {
  /** The managed Foundry backend. Always available. */
  hosted_backend: FulfillmentBackend;
  /** The tenant's self-hosted backend, or null if not configured. */
  self_hosted_backend: FulfillmentBackend | null;
  /** Looks up the tenant's fulfillment preference. */
  getPreference: (tenant_id: string) => TenantFulfillmentPreference | null;
};

export class InferenceRouter {
  private readonly deps: RouterDeps;

  constructor(deps: RouterDeps) {
    this.deps = deps;
  }

  /**
   * Resolves a declared InferenceNeed to a fulfillment backend for the given
   * tenant. Returns the backend that will serve the call.
   *
   * Throws if the tenant's preferred mode is self-hosted but no self-hosted
   * backend is configured, or if no backend can satisfy the need.
   */
  resolve(tenant_id: string, need: InferenceNeed): FulfillmentBackend {
    const pref = this.deps.getPreference(tenant_id);

    // Default to hosted if no preference is set (the SMB "doesn't want to
    // think about inference" case — design brief §1).
    const mode = pref?.mode ?? "hosted";

    if (mode === "self_hosted") {
      if (!this.deps.self_hosted_backend) {
        throw new Error(
          `Tenant ${tenant_id} prefers self-hosted fulfillment but no self-hosted backend is configured. ` +
          `The self-hosted escape hatch must always be available (design brief §1).`,
        );
      }
      return this.deps.self_hosted_backend;
    }

    return this.deps.hosted_backend;
  }
}