import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { ProviderConfig } from "@commons-board/shared";
import { fetchSubscriptionState, buildPortalUrl, generateHandoffToken } from "../lib/olf-subscription.js";

/**
 * Tests for the OLF subscription client and portal link-out.
 *
 * Proves:
 *  - fetchSubscriptionState sends Bearer auth and parses the response
 *  - fetchSubscriptionState returns status "unknown" on error (never throws)
 *  - fetchSubscriptionState returns "unknown" when no API key is configured
 *  - buildPortalUrl appends a signed hand-off token
 *  - generateHandoffToken returns null when no key is configured
 *  - the API key is never included in the returned state
 */
describe("OLF subscription client", () => {
  let server: Server;
  let baseUrl: string;
  let lastRequest: { headers: Record<string, string>; url: string } | null;

  beforeEach(async () => {
    lastRequest = null;
    server = createServer((req, res) => {
      lastRequest = {
        headers: req.headers as Record<string, string>,
        url: req.url ?? "",
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        status: "active",
        plan_name: "Collective",
        tokens_used: 50000,
        token_limit: 100000,
        period_end: "2026-09-01T00:00:00Z",
        portal_url: "https://openlaborfoundation.org/portal",
      }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a network address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
    return {
      provider_id: "olf-managed",
      kind: "olf_managed",
      display_name: "OLF Managed Inference",
      model: "open-moe",
      api_key: "olf-test-key-123",
      api_key_env: null,
      endpoint: baseUrl,
      options: {},
      ...overrides,
    };
  }

  test("fetchSubscriptionState sends Bearer auth and parses the response", async () => {
    const state = await fetchSubscriptionState(makeConfig());
    assert.equal(state.status, "active");
    assert.equal(state.plan_name, "Collective");
    assert.equal(state.tokens_used, 50000);
    assert.equal(state.token_limit, 100000);
    assert.equal(state.period_end, "2026-09-01T00:00:00Z");
    assert.equal(state.portal_url, "https://openlaborfoundation.org/portal");
    // Verify Bearer auth was sent
    assert.equal(lastRequest?.headers.authorization, "Bearer olf-test-key-123");
    // Verify it hit /subscription
    assert.equal(lastRequest?.url, "/subscription");
  });

  test("fetchSubscriptionState returns status unknown on HTTP error (never throws)", async () => {
    // Replace the server with one that returns 500
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server = createServer((_req, res) => {
      res.writeHead(500);
      res.end("internal error");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a network address");
    baseUrl = `http://127.0.0.1:${address.port}`;

    const state = await fetchSubscriptionState(makeConfig());
    assert.equal(state.status, "unknown");
    assert.equal(state.plan_name, null);
    assert.equal(state.tokens_used, null);
  });

  test("fetchSubscriptionState returns unknown when no API key is configured", async () => {
    const state = await fetchSubscriptionState(makeConfig({ api_key: null, api_key_env: null }));
    assert.equal(state.status, "unknown");
    // Should not have hit the server
    assert.equal(lastRequest, null);
  });

  test("fetchSubscriptionState returns unknown on network error (never throws)", async () => {
    // Point at a port that's not listening
    const state = await fetchSubscriptionState(makeConfig({ endpoint: "http://127.0.0.1:1" }));
    assert.equal(state.status, "unknown");
  });

  test("the API key is never included in the returned state", async () => {
    const state = await fetchSubscriptionState(makeConfig({ api_key: "secret-key-abc" }));
    const serialized = JSON.stringify(state);
    assert.ok(!serialized.includes("secret-key-abc"), "API key must not appear in subscription state");
    assert.ok(!serialized.includes("olf-test-key-123"), "API key must not appear in subscription state");
  });

  test("generateHandoffToken returns a non-null token when key is configured", () => {
    const token = generateHandoffToken(makeConfig({ api_key: "test-key" }));
    assert.ok(token !== null, "token should not be null when key is set");
    assert.ok(token.includes("."), "token should contain a dot separator");
  });

  test("generateHandoffToken returns null when no key is configured", () => {
    const token = generateHandoffToken(makeConfig({ api_key: null, api_key_env: null }));
    assert.equal(token, null);
  });

  test("buildPortalUrl appends a hand-off token as query parameter", () => {
    const config = makeConfig({ api_key: "test-key" });
    const state = {
      status: "active" as const,
      plan_name: "Collective",
      tokens_used: 100,
      token_limit: 1000,
      period_end: "2026-09-01T00:00:00Z",
      portal_url: "https://portal.example.com/manage",
    };
    const url = buildPortalUrl(config, state);
    assert.ok(url.includes("handoff="), "portal URL should contain hand-off token");
    assert.ok(url.startsWith("https://portal.example.com/manage?handoff="), "URL should start with portal base + handoff param");
  });

  test("buildPortalUrl works with a portal URL that already has query params", () => {
    const config = makeConfig({ api_key: "test-key" });
    const state = {
      status: "active" as const,
      plan_name: null,
      tokens_used: null,
      token_limit: null,
      period_end: null,
      portal_url: "https://portal.example.com/manage?tab=billing",
    };
    const url = buildPortalUrl(config, state);
    assert.ok(url.includes("&handoff="), "should append with & when URL already has query params");
  });

  test("buildPortalUrl returns base URL without token when no key is configured", () => {
    const config = makeConfig({ api_key: null, api_key_env: null });
    const state = {
      status: "unknown" as const,
      plan_name: null,
      tokens_used: null,
      token_limit: null,
      period_end: null,
      portal_url: "https://portal.example.com/manage",
    };
    const url = buildPortalUrl(config, state);
    assert.equal(url, "https://portal.example.com/manage");
    assert.ok(!url.includes("handoff"), "should not include hand-off token when no key");
  });
});