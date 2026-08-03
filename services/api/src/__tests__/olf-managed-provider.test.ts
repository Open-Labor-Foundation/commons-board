import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import "../lib/provider/bootstrap.js";
import { createProvider } from "../lib/provider/index.js";
import type { ProviderConfig, InferenceRequest } from "@commons-board/shared";

/**
 * Conformance test for the olf_managed adapter against a mock OpenAI-compatible
 * endpoint. Proves the adapter:
 *  - sends a standard /chat/completions request with Bearer auth
 *  - returns ok:true with the response text
 *  - surfaces the resolved model from the response (provenance)
 *  - fails cleanly on HTTP error
 *  - requires an API key (invariant 3: API key = identity)
 */
describe("olf_managed adapter conformance", () => {
  let server: Server;
  let baseUrl: string;
  let lastRequest: { headers: Record<string, string>; body: string } | null;

  beforeEach(async () => {
    lastRequest = null;
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        lastRequest = {
          headers: req.headers as Record<string, string>,
          body: Buffer.concat(chunks).toString(),
        };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          choices: [{ message: { content: "test response" }, finish_reason: "stop" }],
          model: "resolved-glm-5.2-2026-08-01",
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }));
      });
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

  const baseReq: InferenceRequest = {
    system: "You are a test assistant.",
    prompt: "Say hello.",
  };

  test("sends standard /chat/completions with Bearer auth", async () => {
    const provider = createProvider(makeConfig());
    const res = await provider.complete(baseReq);

    assert.equal(res.ok, true);
    assert.equal(res.text, "test response");
    assert.equal(lastRequest?.headers.authorization, "Bearer olf-test-key-123");

    const body = JSON.parse(lastRequest!.body);
    assert.equal(body.model, "open-moe");
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[0].content, "You are a test assistant.");
    assert.equal(body.messages[body.messages.length - 1].role, "user");
    assert.equal(body.messages[body.messages.length - 1].content, "Say hello.");
  });

  test("surfaces resolved model from response for provenance", async () => {
    const provider = createProvider(makeConfig());
    const res = await provider.complete(baseReq);

    assert.equal(res.ok, true);
    // The adapter should surface the model the service actually used, not the
    // abstract model_class that was requested.
    assert.equal(res.model, "resolved-glm-5.2-2026-08-01");
  });

  test("fails cleanly on HTTP error with denial mapping", async () => {
    server.close();
    server = createServer((req, res) => {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "subscription exhausted" } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a network address");
    baseUrl = `http://127.0.0.1:${address.port}`;

    const provider = createProvider(makeConfig());
    const res = await provider.complete(baseReq);

    assert.equal(res.ok, false);
    assert.ok(res.error?.includes("403"));
    // Phase 4: denial mapping should give an actionable message
    assert.ok(res.error?.includes("suspended"));
  });

  test("denial mapping: 401 maps to key rejected", async () => {
    server.close();
    server = createServer((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "invalid api key" } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a network address");
    baseUrl = `http://127.0.0.1:${address.port}`;

    const provider = createProvider(makeConfig());
    const res = await provider.complete(baseReq);

    assert.equal(res.ok, false);
    assert.ok(res.error?.includes("401"));
    assert.ok(res.error?.includes("rejected"));
  });

  test("denial mapping: 402 maps to subscription exhausted", async () => {
    server.close();
    server = createServer((_req, res) => {
      res.writeHead(402, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "payment required" } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a network address");
    baseUrl = `http://127.0.0.1:${address.port}`;

    const provider = createProvider(makeConfig());
    const res = await provider.complete(baseReq);

    assert.equal(res.ok, false);
    assert.ok(res.error?.includes("402"));
    assert.ok(res.error?.includes("exhausted"));
  });

  test("denial mapping: 429 maps to rate limited", async () => {
    server.close();
    server = createServer((_req, res) => {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "rate limit" } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a network address");
    baseUrl = `http://127.0.0.1:${address.port}`;

    const provider = createProvider(makeConfig());
    const res = await provider.complete(baseReq);

    assert.equal(res.ok, false);
    assert.ok(res.error?.includes("429"));
    assert.ok(res.error?.includes("rate limited"));
  });

  test("API key is never echoed in the response payload (invariant 3: key = identity)", async () => {
    const provider = createProvider(makeConfig({ api_key: "olf-secret-key-do-not-leak-999" }));
    const res = await provider.complete(baseReq);

    assert.equal(res.ok, true);
    // The key must never appear in any field of the response
    const responseJson = JSON.stringify(res);
    assert.ok(!responseJson.includes("olf-secret-key-do-not-leak-999"),
      "API key must not appear in the InferenceResponse payload");
  });

  test("API key is never echoed in error responses either", async () => {
    server.close();
    server = createServer((_req, res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "internal error with key olf-secret-key-do-not-leak-999" } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a network address");
    baseUrl = `http://127.0.0.1:${address.port}`;

    const provider = createProvider(makeConfig({ api_key: "olf-secret-key-do-not-leak-999" }));
    const res = await provider.complete(baseReq);

    assert.equal(res.ok, false);
    // Even if the provider echoes the key in its error, the adapter must not
    // pass it through — the error should be the mapped denial message, not
    // the raw provider response body.
    const responseJson = JSON.stringify(res);
    assert.ok(!responseJson.includes("olf-secret-key-do-not-leak-999"),
      "API key must not appear in error responses");
  });

  test("surfaces usage tokens in response for metering", async () => {
    const provider = createProvider(makeConfig());
    const res = await provider.complete(baseReq);

    assert.equal(res.ok, true);
    assert.ok(res.usage, "usage should be populated");
    assert.equal(res.usage!.prompt_tokens, 10);
    assert.equal(res.usage!.completion_tokens, 5);
    assert.equal(res.usage!.total_tokens, 15);
  });

  test("requires an API key (invariant 3: key = identity)", async () => {
    const provider = createProvider(makeConfig({ api_key: null, api_key_env: null }));
    const res = await provider.complete(baseReq);

    assert.equal(res.ok, false);
    assert.ok(res.error?.includes("API key"));
  });

  test("uses default OLF endpoint when no endpoint configured", async () => {
    // This test verifies the default URL is used — we can't hit it, but we
    // can verify the adapter doesn't fail with "no endpoint configured".
    // The request will fail on connection, but the error should be a network
    // error, not a config error.
    const provider = createProvider(makeConfig({
      endpoint: null,
      api_key: "olf-test-key",
    }));
    const res = await provider.complete(baseReq);

    // Should fail with a network error (connection refused), not "no endpoint"
    assert.equal(res.ok, false);
    assert.ok(!res.error?.includes("no endpoint configured"));
  });
});

/**
 * Regression test: a third-party hosted_api provider is unaffected by the
 * addition of "olf_managed" to the ProviderKind union. The factory still
 * creates a working hosted_api adapter.
 */
describe("hosted_api regression after ProviderKind union change", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          choices: [{ message: { content: "hosted api works" }, finish_reason: "stop" }],
          model: "resolved-qwen3-32b-2026-08-01",
          usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
        }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a network address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("hosted_api provider still works unchanged", async () => {
    const config: ProviderConfig = {
      provider_id: "featherless",
      kind: "hosted_api",
      display_name: "Featherless AI",
      model: "Qwen/Qwen3-32B",
      api_key: "test-key",
      api_key_env: null,
      endpoint: baseUrl,
      options: {},
      concurrency_lanes: 1,
      concurrency_cost: 1,
    };

    const provider = createProvider(config);
    const res = await provider.complete({
      system: "system prompt",
      prompt: "user prompt",
    });

    assert.equal(res.ok, true);
    assert.equal(res.text, "hosted api works");
    assert.equal(res.provider_id, "featherless");
    assert.equal(provider.kind, "hosted_api");
  });

  test("hosted_api surfaces resolved model from response for provenance", async () => {
    const config: ProviderConfig = {
      provider_id: "featherless",
      kind: "hosted_api",
      display_name: "Featherless AI",
      model: "Qwen/Qwen3-32B",
      api_key: "test-key",
      api_key_env: null,
      endpoint: baseUrl,
      options: {},
      concurrency_lanes: 1,
      concurrency_cost: 1,
    };

    const provider = createProvider(config);
    const res = await provider.complete({
      system: "system prompt",
      prompt: "user prompt",
    });

    assert.equal(res.ok, true);
    // Phase 4: should surface the resolved model, not the requested alias
    assert.equal(res.model, "resolved-qwen3-32b-2026-08-01");
    assert.ok(res.usage, "usage should be populated");
    assert.equal(res.usage!.total_tokens, 11);
  });

  test("hosted_api denial mapping: 401 maps to key rejected", async () => {
    server.close();
    server = createServer((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "unauthorized" } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a network address");
    baseUrl = `http://127.0.0.1:${address.port}`;

    const config: ProviderConfig = {
      provider_id: "featherless",
      kind: "hosted_api",
      display_name: "Featherless AI",
      model: "Qwen/Qwen3-32B",
      api_key: "test-key",
      api_key_env: null,
      endpoint: baseUrl,
      options: {},
      concurrency_lanes: 1,
      concurrency_cost: 1,
    };

    const provider = createProvider(config);
    const res = await provider.complete({
      system: "system prompt",
      prompt: "user prompt",
    });

    assert.equal(res.ok, false);
    assert.ok(res.error?.includes("401"));
    assert.ok(res.error?.includes("rejected"));
  });
});