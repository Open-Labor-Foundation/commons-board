/**
 * Capacity-based pricing — design brief §6.
 *
 * Because artifacts disclose expected inference cost, pricing is COMPUTED
 * from declarations plus a safety margin, not pulled from the air the way
 * featherless priced "unlimited". This module closes the loop between the
 * declared need (step 1) and the enforced ceiling (step 2):
 *
 *   - A tenant's plan is the sum of the artifacts they run.
 *   - A fixed tier's token ceiling falls out of those declarations plus margin.
 *   - Price by declared capacity ("up to N artifacts of these classes"), not
 *     raw tokens — more predictable revenue and more legible to a non-technical
 *     buyer. This also de-anchors price from Foundry's public per-token rates,
 *     protecting margin.
 *   - When Foundry token prices move or a backend model is swapped, the
 *     artifact's disclosed cost updates and pricing RE-DERIVES. The system
 *     stays solvent through price changes instead of being caught flat-footed
 *     — the other way featherless-style operations die.
 *
 * The ceiling derived here feeds TenantProvisioning.token_ceiling, which the
 * InferenceGateway enforces as a hard cap (invariant #1). So the economic
 * model and the enforcement mechanism are connected: the ceiling is derived
 * from declarations (§6) but enforced in tokens at the gateway (§4).
 */
import type { InferenceNeed } from "./types.js";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * A tenant's subscribed capacity — the artifacts they run and the calls/month
 * they expect per artifact. This is the "declared capacity" that price is
 * based on (§6), not raw tokens.
 */
export type TenantCapacity = {
  tenant_id: string;
  /** The artifacts the tenant runs, each with its declared inference need. */
  artifacts: Array<{
    artifact_id: string;
    need: InferenceNeed;
    /** Expected calls per billing period for this artifact. */
    expected_calls_per_period: number;
  }>;
};

/**
 * A pricing tier — capacity-based, not token-based. The tier names a capacity
 * ("up to N artifacts of these classes") and the ceiling falls out of the
 * declarations. Price is expressed per capacity unit, de-anchored from
 * Foundry's per-token rates.
 */
export type PricingTier = {
  tier_id: string;
  tier_name: string;
  /** Maximum artifacts allowed in this tier. */
  max_artifacts: number;
  /** Price per billing period for the tier (flat, capacity-based). */
  flat_price_usd: number;
  /** Per-token price for overage above the ceiling (metered above cost, §5). */
  overage_price_per_1k_tokens_usd: number;
};

/**
 * The derived plan for a tenant — the token ceiling computed from their
 * declared capacity plus margin, and the price based on their tier.
 */
export type DerivedPlan = {
  tenant_id: string;
  tier: PricingTier;
  /** The hard token ceiling for the billing period (feeds invariant #1). */
  token_ceiling: number;
  /** Breakdown of how the ceiling was derived (for transparency/audit). */
  ceiling_breakdown: Array<{
    artifact_id: string;
    expected_calls: number;
    declared_tokens_per_call: number;
    subtotal_tokens: number;
  }>;
  /** The safety margin applied (fraction, e.g. 0.15 = 15%). */
  safety_margin: number;
  /** Sum of declared tokens before margin. */
  base_tokens: number;
  /** Flat price for the period. */
  flat_price_usd: number;
  /** Per-token overage price. */
  overage_price_per_1k_tokens_usd: number;
};

/**
 * Foundry's per-token price for a model class. When this moves, the artifact's
 * disclosed cost updates and pricing re-derives (§6). This is the input that
 * keeps the system solvent through price changes.
 */
export type FoundryTokenPrice = {
  model_class: string;
  price_per_1k_input_tokens_usd: number;
  price_per_1k_output_tokens_usd: number;
};

export type PricingConfig = {
  /**
   * Safety margin applied to the sum of declared costs (fraction).
   * E.g. 0.15 = 15% margin above the declared total. This absorbs small
   * declared-vs-actual drift (§7) before it hits the hard ceiling.
   * Defaults to 0.15.
   */
  safety_margin?: number;
};

// ── Derivation ───────────────────────────────────────────────────────────────

/**
 * Derives a tenant's plan from their declared capacity and pricing tier.
 *
 * The token ceiling is:
 *   sum(artifact.expected_calls * artifact.need.disclosed_cost.expected_tokens_per_call)
 *   * (1 + safety_margin)
 *
 * This is the ceiling the InferenceGateway enforces as a hard cap (invariant #1).
 * It's derived from declarations (§6), not guessed — the featherless failure
 * mode was guessing "unlimited"; here the ceiling falls out of what the
 * artifacts actually declare.
 *
 * Throws if the tenant's artifact count exceeds the tier's max_artifacts.
 */
export function derivePlan(
  capacity: TenantCapacity,
  tier: PricingTier,
  config?: PricingConfig,
): DerivedPlan {
  const margin = config?.safety_margin ?? 0.15;

  if (capacity.artifacts.length > tier.max_artifacts) {
    throw new Error(
      `Tenant ${capacity.tenant_id} runs ${capacity.artifacts.length} artifacts ` +
      `but tier "${tier.tier_name}" allows max ${tier.max_artifacts}. ` +
      `Capacity-based pricing (§6) requires the tier to cover the declared capacity.`,
    );
  }

  const ceiling_breakdown = capacity.artifacts.map((entry) => {
    const subtotal = entry.expected_calls_per_period * entry.need.disclosed_cost.expected_tokens_per_call;
    return {
      artifact_id: entry.artifact_id,
      expected_calls: entry.expected_calls_per_period,
      declared_tokens_per_call: entry.need.disclosed_cost.expected_tokens_per_call,
      subtotal_tokens: subtotal,
    };
  });

  const base_tokens = ceiling_breakdown.reduce((sum, b) => sum + b.subtotal_tokens, 0);
  const token_ceiling = Math.ceil(base_tokens * (1 + margin));

  return {
    tenant_id: capacity.tenant_id,
    tier,
    token_ceiling,
    ceiling_breakdown,
    safety_margin: margin,
    base_tokens,
    flat_price_usd: tier.flat_price_usd,
    overage_price_per_1k_tokens_usd: tier.overage_price_per_1k_tokens_usd,
  };
}

/**
 * Re-derives a plan when Foundry token prices change or a backend model is
 * swapped (§6). The artifact's disclosed cost updates and pricing re-derives,
 * so the system stays solvent through price changes instead of being caught
 * flat-footed.
 *
 * This function takes the current capacity, the updated Foundry prices, and
 * re-derives the plan. The ceiling may change — if Foundry prices drop, the
 * same flat price buys more headroom; if prices rise, the ceiling tightens
 * or the flat price must increase to maintain the same capacity.
 *
 * Returns the re-derived plan plus a solvency assessment: whether the flat
 * price still covers the Foundry cost at the declared volume.
 */
export function rederivePlan(
  capacity: TenantCapacity,
  tier: PricingTier,
  foundry_prices: FoundryTokenPrice[],
  config?: PricingConfig,
): DerivedPlan & {
  foundry_cost_estimate_usd: number;
  is_solvent: boolean;
} {
  const plan = derivePlan(capacity, tier, config);
  const priceIndex = new Map(foundry_prices.map((p) => [p.model_class, p]));

  // Estimate Foundry cost: for each artifact, compute the expected token cost
  // at Foundry's current prices, using the declared typical input/output split
  // (falling back to a 50/50 split if not declared).
  let foundry_cost_estimate_usd = 0;
  for (const entry of capacity.artifacts) {
    const price = priceIndex.get(entry.need.model_class);
    if (!price) {
      // If we don't have a Foundry price for this model class, we can't
      // assess solvency — treat as insolvent to force a price update.
      foundry_cost_estimate_usd = Infinity;
      break;
    }
    const typical_input = entry.need.context.typical_input_tokens ?? entry.need.disclosed_cost.expected_tokens_per_call / 2;
    const typical_output = entry.need.context.typical_output_tokens ?? entry.need.disclosed_cost.expected_tokens_per_call / 2;
    const cost_per_call =
      (typical_input / 1000) * price.price_per_1k_input_tokens_usd +
      (typical_output / 1000) * price.price_per_1k_output_tokens_usd;
    foundry_cost_estimate_usd += cost_per_call * entry.expected_calls_per_period;
  }

  const is_solvent = foundry_cost_estimate_usd < tier.flat_price_usd;

  return {
    ...plan,
    foundry_cost_estimate_usd,
    is_solvent,
  };
}