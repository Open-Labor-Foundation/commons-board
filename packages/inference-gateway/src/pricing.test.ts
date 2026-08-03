/**
 * Tests for capacity-based pricing (design brief §6).
 *
 * These prove the ceiling is DERIVED from declarations, not guessed — the
 * core distinction from featherless's "unlimited" pricing. They also prove
 * re-derivation works when Foundry prices change, so the system stays
 * solvent through price changes.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  derivePlan,
  rederivePlan,
  type TenantCapacity,
  type PricingTier,
  type FoundryTokenPrice,
  type InferenceNeed,
} from "./index.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeNeed(overrides?: Partial<InferenceNeed>): InferenceNeed {
  return {
    determination_type: "synthesis",
    model_class: "open-moe",
    context: { min_tokens: 8192, typical_input_tokens: 3500, typical_output_tokens: 1200 },
    version_pin: { declared_version: "glm-5.2", pin_policy: "exact" },
    disclosed_cost: { expected_tokens_per_call: 4700, basis: "estimated" },
    ...overrides,
  };
}

const STANDARD_TIER: PricingTier = {
  tier_id: "standard",
  tier_name: "Standard (up to 5 artifacts)",
  max_artifacts: 5,
  flat_price_usd: 99,
  overage_price_per_1k_tokens_usd: 0.002,
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("derivePlan — ceiling derived from declarations (§6)", () => {
  it("computes the ceiling as sum(declared_cost * calls) * (1 + margin)", () => {
    const capacity: TenantCapacity = {
      tenant_id: "t1",
      artifacts: [
        { artifact_id: "a1", need: makeNeed({ disclosed_cost: { expected_tokens_per_call: 4000, basis: "estimated" } }), expected_calls_per_period: 100 },
        { artifact_id: "a2", need: makeNeed({ disclosed_cost: { expected_tokens_per_call: 2000, basis: "estimated" } }), expected_calls_per_period: 50 },
      ],
    };

    const plan = derivePlan(capacity, STANDARD_TIER, { safety_margin: 0.15 });

    // base = 4000*100 + 2000*50 = 400,000 + 100,000 = 500,000
    // ceiling = 500,000 * 1.15 = 575,000
    assert.equal(plan.base_tokens, 500_000);
    assert.equal(plan.token_ceiling, 575_000);
    assert.equal(plan.ceiling_breakdown.length, 2);
    assert.equal(plan.ceiling_breakdown[0].subtotal_tokens, 400_000);
    assert.equal(plan.ceiling_breakdown[1].subtotal_tokens, 100_000);
  });

  it("uses default 15% margin when not specified", () => {
    const capacity: TenantCapacity = {
      tenant_id: "t1",
      artifacts: [
        { artifact_id: "a1", need: makeNeed({ disclosed_cost: { expected_tokens_per_call: 1000, basis: "estimated" } }), expected_calls_per_period: 10 },
      ],
    };

    const plan = derivePlan(capacity, STANDARD_TIER);

    // base = 1000*10 = 10,000; ceiling = 10,000 * 1.15 = 11,500
    assert.equal(plan.base_tokens, 10_000);
    assert.equal(plan.token_ceiling, 11_500);
    assert.equal(plan.safety_margin, 0.15);
  });

  it("throws when artifact count exceeds tier max", () => {
    const capacity: TenantCapacity = {
      tenant_id: "t1",
      artifacts: Array.from({ length: 6 }, (_, i) => ({
        artifact_id: `a${i}`,
        need: makeNeed(),
        expected_calls_per_period: 10,
      })),
    };

    assert.throws(
      () => derivePlan(capacity, STANDARD_TIER),
      /runs 6 artifacts but tier.*allows max 5/,
    );
  });

  it("price is capacity-based (flat), not raw-token-based", () => {
    const capacity: TenantCapacity = {
      tenant_id: "t1",
      artifacts: [
        { artifact_id: "a1", need: makeNeed(), expected_calls_per_period: 100 },
      ],
    };

    const plan = derivePlan(capacity, STANDARD_TIER);

    // The flat price is the tier's price, not derived from token count.
    // This de-anchors price from Foundry's per-token rates (§6).
    assert.equal(plan.flat_price_usd, 99);
    assert.equal(plan.overage_price_per_1k_tokens_usd, 0.002);
  });
});

describe("rederivePlan — re-derivation on Foundry price change (§6)", () => {
  it("stays solvent when Foundry cost is below flat price", () => {
    const capacity: TenantCapacity = {
      tenant_id: "t1",
      artifacts: [
        {
          artifact_id: "a1",
          need: makeNeed({
            context: { min_tokens: 8192, typical_input_tokens: 3500, typical_output_tokens: 1200 },
            disclosed_cost: { expected_tokens_per_call: 4700, basis: "estimated" },
          }),
          expected_calls_per_period: 100,
        },
      ],
    };

    const prices: FoundryTokenPrice[] = [
      {
        model_class: "open-moe",
        price_per_1k_input_tokens_usd: 0.0005,
        price_per_1k_output_tokens_usd: 0.0015,
      },
    ];

    const plan = rederivePlan(capacity, STANDARD_TIER, prices);

    // Foundry cost = (3500/1000 * 0.0005 + 1200/1000 * 0.0015) * 100
    //             = (0.00175 + 0.0018) * 100 = 0.00355 * 100 = $0.355
    // Flat price = $99 → solvent
    assert.equal(plan.is_solvent, true);
    assert.ok(plan.foundry_cost_estimate_usd < plan.flat_price_usd);
  });

  it("goes insolvent when Foundry prices rise above flat price", () => {
    const capacity: TenantCapacity = {
      tenant_id: "t1",
      artifacts: [
        {
          artifact_id: "a1",
          need: makeNeed({
            context: { min_tokens: 8192, typical_input_tokens: 3500, typical_output_tokens: 1200 },
            disclosed_cost: { expected_tokens_per_call: 4700, basis: "estimated" },
          }),
          expected_calls_per_period: 10_000,
        },
      ],
    };

    const prices: FoundryTokenPrice[] = [
      {
        model_class: "open-moe",
        price_per_1k_input_tokens_usd: 0.05,
        price_per_1k_output_tokens_usd: 0.15,
      },
    ];

    const plan = rederivePlan(capacity, STANDARD_TIER, prices);

    // Foundry cost = (3500/1000 * 0.05 + 1200/1000 * 0.15) * 10,000
    //             = (0.175 + 0.18) * 10,000 = 0.355 * 10,000 = $3,550
    // Flat price = $99 → insolvent
    assert.equal(plan.is_solvent, false);
    assert.ok(plan.foundry_cost_estimate_usd > plan.flat_price_usd);
  });

  it("treats missing Foundry price as insolvent (forces price update)", () => {
    const capacity: TenantCapacity = {
      tenant_id: "t1",
      artifacts: [
        { artifact_id: "a1", need: makeNeed({ model_class: "unknown-class" }), expected_calls_per_period: 10 },
      ],
    };

    const prices: FoundryTokenPrice[] = [
      { model_class: "open-moe", price_per_1k_input_tokens_usd: 0.001, price_per_1k_output_tokens_usd: 0.002 },
    ];

    const plan = rederivePlan(capacity, STANDARD_TIER, prices);

    assert.equal(plan.is_solvent, false, "missing Foundry price should force insolvent");
    assert.equal(plan.foundry_cost_estimate_usd, Infinity);
  });

  it("re-derives the same ceiling as derivePlan (ceiling is declaration-driven, not price-driven)", () => {
    const capacity: TenantCapacity = {
      tenant_id: "t1",
      artifacts: [
        { artifact_id: "a1", need: makeNeed({ disclosed_cost: { expected_tokens_per_call: 5000, basis: "estimated" } }), expected_calls_per_period: 20 },
      ],
    };

    const prices: FoundryTokenPrice[] = [
      { model_class: "open-moe", price_per_1k_input_tokens_usd: 0.001, price_per_1k_output_tokens_usd: 0.002 },
    ];

    const derived = derivePlan(capacity, STANDARD_TIER, { safety_margin: 0.15 });
    const rederived = rederivePlan(capacity, STANDARD_TIER, prices, { safety_margin: 0.15 });

    // The ceiling comes from declarations, not Foundry prices. Re-derivation
    // with different Foundry prices should produce the SAME ceiling — only
    // the solvency assessment changes.
    assert.equal(rederived.token_ceiling, derived.token_ceiling);
    assert.equal(rederived.base_tokens, derived.base_tokens);
  });
});