/**
 * Tests for the InferenceGateway — these are the reachability proof (OLF
 * verification rule 1) that the five load-bearing invariants (design brief
 * §4) are actually enforced, not just present in the type definitions.
 *
 * Each test names the invariant it proves and the surface it tests. The
 * "user" of the gateway is the commons-board API route that dispatches
 * inference; the surface is the InferenceGateway.call() method. These tests
 * prove that surface enforces the invariants.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  InferenceGateway,
  TokenCeilingExceededError,
  NoActiveSubscriptionError,
  VersionPinViolationError,
  type TenantProvisioning,
  type MeteringRecord,
  type FulfillmentBackend,
  type FulfillmentRequest,
  type FulfillmentResult,
  type InferenceNeed,
} from "./index.js";

// ── Test fixtures ────────────────────────────────────────────────────────────

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

function makeTenant(overrides?: Partial<TenantProvisioning>): TenantProvisioning {
  return {
    tenant_id: "tenant-a",
    subscription_id: "sub-1",
    subscription_status: "active",
    token_ceiling: 100_000,
    tokens_consumed: 0,
    gateway_api_key: "gw-key-a",
    period_start: "2026-08-01T00:00:00Z",
    period_end: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

/** A mock backend that returns a fixed result with configurable token counts. */
function makeMockBackend(
  model_version_served: string,
  input_tokens: number,
  output_tokens: number,
  text = "mock response",
  ok = true,
): FulfillmentBackend {
  return {
    kind: "hosted",
    backend_id: "mock-backend",
    async fulfill(_req: FulfillmentRequest): Promise<FulfillmentResult> {
      return {
        ok,
        text,
        model_version_served,
        input_tokens,
        output_tokens,
        error: ok ? undefined : "mock error",
      };
    },
  };
}

function makeGatewayDeps(tenants: Map<string, TenantProvisioning>) {
  const metering: MeteringRecord[] = [];
  return {
    deps: {
      getTenant: (id: string) => tenants.get(id) ?? null,
      updateConsumption: (id: string, consumed: number) => {
        const t = tenants.get(id);
        if (t) t.tokens_consumed = consumed;
      },
      recordMetering: (record: MeteringRecord) => metering.push(record),
    },
    metering,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("InferenceGateway — invariant #1: hard token ceiling", () => {
  it("refuses the call when tokens_consumed + estimate exceeds the ceiling", async () => {
    // Tenant has consumed 96,000 of 100,000 tokens. The declared cost is
    // 4,700, so the pre-call estimate (with 10% margin) is 5,170.
    // 96,000 + 5,170 = 101,170 > 100,000 → refused.
    const tenants = new Map([["t1", makeTenant({ tenant_id: "t1", tokens_consumed: 96_000, token_ceiling: 100_000 })]]);
    const { deps, metering } = makeGatewayDeps(tenants);
    const gateway = new InferenceGateway(deps);
    const backend = makeMockBackend("glm-5.2", 3500, 1200);

    await assert.rejects(
      () => gateway.call(backend, { tenant_id: "t1", artifact_id: "art-1", request: { system: "s", prompt: "p", need: makeNeed() } }),
      (err: unknown) => {
        assert.ok(err instanceof TokenCeilingExceededError, "should throw TokenCeilingExceededError");
        assert.equal((err as TokenCeilingExceededError).tenant_id, "t1");
        return true;
      },
    );
    // No metering recorded — the call never reached the backend.
    assert.equal(metering.length, 0, "no metering should be recorded for a refused call");
    // Consumption unchanged.
    assert.equal(tenants.get("t1")?.tokens_consumed, 96_000, "consumption must not change for a refused call");
  });

  it("allows the call when tokens_consumed + estimate fits within the ceiling", async () => {
    const tenants = new Map([["t1", makeTenant({ tenant_id: "t1", tokens_consumed: 90_000, token_ceiling: 100_000 })]]);
    const { deps, metering } = makeGatewayDeps(tenants);
    const gateway = new InferenceGateway(deps);
    const backend = makeMockBackend("glm-5.2", 3500, 1200);

    const result = await gateway.call(backend, { tenant_id: "t1", artifact_id: "art-1", request: { system: "s", prompt: "p", need: makeNeed() } });

    assert.ok(result.ok);
    assert.equal(result.metering.total_tokens, 4700);
    assert.equal(tenants.get("t1")?.tokens_consumed, 94_700, "consumption should increase by actual tokens used");
    assert.equal(metering.length, 1);
  });
});

describe("InferenceGateway — invariant #2: active subscription required", () => {
  it("refuses inference when no tenant is provisioned", async () => {
    const tenants = new Map<string, TenantProvisioning>();
    const { deps } = makeGatewayDeps(tenants);
    const gateway = new InferenceGateway(deps);
    const backend = makeMockBackend("glm-5.2", 100, 100);

    await assert.rejects(
      () => gateway.call(backend, { tenant_id: "unknown", artifact_id: "art-1", request: { system: "s", prompt: "p", need: makeNeed() } }),
      (err: unknown) => err instanceof NoActiveSubscriptionError,
    );
  });

  it("refuses inference when subscription is suspended", async () => {
    const tenants = new Map([["t1", makeTenant({ tenant_id: "t1", subscription_status: "suspended" })]]);
    const { deps } = makeGatewayDeps(tenants);
    const gateway = new InferenceGateway(deps);
    const backend = makeMockBackend("glm-5.2", 100, 100);

    await assert.rejects(
      () => gateway.call(backend, { tenant_id: "t1", artifact_id: "art-1", request: { system: "s", prompt: "p", need: makeNeed() } }),
      (err: unknown) => err instanceof NoActiveSubscriptionError,
    );
  });
});

describe("InferenceGateway — invariant #4: per-tenant attribution", () => {
  it("metering records the tenant_id, not a pool", async () => {
    const tenants = new Map([
      ["t1", makeTenant({ tenant_id: "t1" })],
      ["t2", makeTenant({ tenant_id: "t2" })],
    ]);
    const { deps, metering } = makeGatewayDeps(tenants);
    const gateway = new InferenceGateway(deps);
    const backend = makeMockBackend("glm-5.2", 3500, 1200);

    await gateway.call(backend, { tenant_id: "t1", artifact_id: "art-1", request: { system: "s", prompt: "p", need: makeNeed() } });
    await gateway.call(backend, { tenant_id: "t2", artifact_id: "art-1", request: { system: "s", prompt: "p", need: makeNeed() } });

    assert.equal(metering.length, 2);
    assert.equal(metering[0].tenant_id, "t1", "first call attributed to t1");
    assert.equal(metering[1].tenant_id, "t2", "second call attributed to t2");
    // Per-tenant consumption is isolated.
    assert.equal(tenants.get("t1")?.tokens_consumed, 4700);
    assert.equal(tenants.get("t2")?.tokens_consumed, 4700);
  });
});

describe("InferenceGateway — §9: version pin enforcement", () => {
  it("throws when exact pin is violated (silent MaaS version update)", async () => {
    const tenants = new Map([["t1", makeTenant({ tenant_id: "t1" })]]);
    const { deps } = makeGatewayDeps(tenants);
    const gateway = new InferenceGateway(deps);
    // Backend serves a different version than the artifact declared.
    const backend = makeMockBackend("glm-5.3", 100, 100);

    await assert.rejects(
      () => gateway.call(backend, { tenant_id: "t1", artifact_id: "art-1", request: { system: "s", prompt: "p", need: makeNeed({ version_pin: { declared_version: "glm-5.2", pin_policy: "exact" } }) } }),
      (err: unknown) => {
        assert.ok(err instanceof VersionPinViolationError);
        assert.equal((err as VersionPinViolationError).declared_version, "glm-5.2");
        assert.equal((err as VersionPinViolationError).served_version, "glm-5.3");
        return true;
      },
    );
  });

  it("allows when exact pin is satisfied", async () => {
    const tenants = new Map([["t1", makeTenant({ tenant_id: "t1" })]]);
    const { deps } = makeGatewayDeps(tenants);
    const gateway = new InferenceGateway(deps);
    const backend = makeMockBackend("glm-5.2", 100, 100);

    const result = await gateway.call(backend, { tenant_id: "t1", artifact_id: "art-1", request: { system: "s", prompt: "p", need: makeNeed({ version_pin: { declared_version: "glm-5.2", pin_policy: "exact" } }) } });
    assert.ok(result.ok);
  });

  it("allows minor pin when major.minor matches", async () => {
    const tenants = new Map([["t1", makeTenant({ tenant_id: "t1" })]]);
    const { deps } = makeGatewayDeps(tenants);
    const gateway = new InferenceGateway(deps);
    // Declared 5.2, served 5.2.1 — minor match.
    const backend = makeMockBackend("glm-5.2.1", 100, 100);

    const result = await gateway.call(backend, { tenant_id: "t1", artifact_id: "art-1", request: { system: "s", prompt: "p", need: makeNeed({ version_pin: { declared_version: "glm-5.2", pin_policy: "minor" } }) } });
    assert.ok(result.ok);
  });

  it("throws on minor pin when major.minor differs", async () => {
    const tenants = new Map([["t1", makeTenant({ tenant_id: "t1" })]]);
    const { deps } = makeGatewayDeps(tenants);
    const gateway = new InferenceGateway(deps);
    // Declared 5.2, served 6.0 — minor mismatch.
    const backend = makeMockBackend("glm-6.0", 100, 100);

    await assert.rejects(
      () => gateway.call(backend, { tenant_id: "t1", artifact_id: "art-1", request: { system: "s", prompt: "p", need: makeNeed({ version_pin: { declared_version: "glm-5.2", pin_policy: "minor" } }) } }),
      (err: unknown) => err instanceof VersionPinViolationError,
    );
  });

  it("allows any pin policy (advisory only)", async () => {
    const tenants = new Map([["t1", makeTenant({ tenant_id: "t1" })]]);
    const { deps } = makeGatewayDeps(tenants);
    const gateway = new InferenceGateway(deps);
    const backend = makeMockBackend("anything", 100, 100);

    const result = await gateway.call(backend, { tenant_id: "t1", artifact_id: "art-1", request: { system: "s", prompt: "p", need: makeNeed({ version_pin: { declared_version: "glm-5.2", pin_policy: "any" } }) } });
    assert.ok(result.ok);
  });
});

describe("InferenceGateway — §7: declared-vs-actual drift detection", () => {
  it("flags metering when actual tokens exceed declared cost", async () => {
    const tenants = new Map([["t1", makeTenant({ tenant_id: "t1" })]]);
    const { deps, metering } = makeGatewayDeps(tenants);
    const gateway = new InferenceGateway(deps);
    // Declared cost is 4700, but the backend reports 8000 total tokens.
    const backend = makeMockBackend("glm-5.2", 6000, 2000);

    const result = await gateway.call(backend, { tenant_id: "t1", artifact_id: "art-1", request: { system: "s", prompt: "p", need: makeNeed({ disclosed_cost: { expected_tokens_per_call: 4700, basis: "estimated" } }) } });

    assert.ok(result.ok);
    assert.equal(result.metering.exceeded_declared_cost, true, "drift should be flagged");
    assert.equal(result.metering.declared_expected_tokens, 4700);
    assert.equal(result.metering.total_tokens, 8000);
  });

  it("does not flag when actual is within declared cost", async () => {
    const tenants = new Map([["t1", makeTenant({ tenant_id: "t1" })]]);
    const { deps, metering } = makeGatewayDeps(tenants);
    const gateway = new InferenceGateway(deps);
    const backend = makeMockBackend("glm-5.2", 3000, 1000);

    const result = await gateway.call(backend, { tenant_id: "t1", artifact_id: "art-1", request: { system: "s", prompt: "p", need: makeNeed({ disclosed_cost: { expected_tokens_per_call: 4700, basis: "estimated" } }) } });

    assert.equal(result.metering.exceeded_declared_cost, false, "no drift when actual < declared");
  });
});

describe("InferenceGateway — invariant #5: metering records actual consumption", () => {
  it("records input, output, and total tokens in the metering record", async () => {
    const tenants = new Map([["t1", makeTenant({ tenant_id: "t1" })]]);
    const { deps, metering } = makeGatewayDeps(tenants);
    const gateway = new InferenceGateway(deps);
    const backend = makeMockBackend("glm-5.2", 3500, 1200);

    const result = await gateway.call(backend, { tenant_id: "t1", artifact_id: "art-1", request: { system: "s", prompt: "p", need: makeNeed() } });

    assert.equal(result.metering.input_tokens, 3500);
    assert.equal(result.metering.output_tokens, 1200);
    assert.equal(result.metering.total_tokens, 4700);
    assert.equal(result.metering.artifact_id, "art-1");
    assert.equal(result.metering.model_version_served, "glm-5.2");
    assert.equal(metering.length, 1);
  });
});