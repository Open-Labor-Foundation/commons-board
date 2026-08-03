import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../lib/provider/bootstrap.js";
import { brokerInferenceRequest } from "../lib/inference-broker.js";
import { getLog } from "../lib/decision-log.js";

/**
 * Covers the addin app inference lane: an addin never holds a provider key
 * or reaches a provider directly -- it calls brokerInferenceRequest, which
 * routes through model-client.ts's complete() (the same chokepoint
 * chair/agent inference already uses) against whatever provider the
 * workspace has configured, and every call is logged to the decision log.
 * Uses an in-process fake HTTP provider (same pattern as
 * model-client-concurrency.test.ts), not a real network call.
 */
describe("brokerInferenceRequest", () => {
  let tempRoot: string;
  let server: Server;
  let baseUrl: string;
  let lastRequestBody: unknown;
  let respondWith: { ok: boolean; status: number };

  beforeEach(async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "inference-broker-test-"));
    process.env.CB_DATA_DIR = tempRoot;
    delete process.env.CB_GOVERNANCE_STRICT_SIGNING;
    respondWith = { ok: true, status: 200 };

    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        lastRequestBody = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (!respondWith.ok) {
          res.writeHead(respondWith.status, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "denied" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          model: "test-model-resolved",
          choices: [{ message: { content: "hello from the addin's requested prompt" } }],
          usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
        }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a network address");
    baseUrl = `http://127.0.0.1:${address.port}`;

    const settingsDir = join(tempRoot, "settings");
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, "default.json"),
      JSON.stringify({
        workspace_id: "default",
        active_provider_id: "test-provider",
        providers: [
          {
            provider_id: "test-provider",
            kind: "hosted_api",
            display_name: "Test Provider",
            model: "test-model",
            api_key: "server-only-test-key",
            endpoint: baseUrl,
            options: {},
          },
        ],
        rbac: { grants: { admin: ["*"], operator: [], member: [], observer: [] } },
        feature_toggles: {},
        updated_at: new Date().toISOString(),
      }),
      "utf8"
    );
  });

  afterEach(async () => {
    delete process.env.CB_DATA_DIR;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("routes through the workspace's configured provider and never exposes its key to the caller", async () => {
    const result = await brokerInferenceRequest("default", "manager-console-user", {
      source: "restaurant-platform:manager-console",
      system: "You are a helpful assistant.",
      prompt: "What's today's prep forecast?",
    });

    assert.equal(result.text, "hello from the addin's requested prompt");
    assert.equal(result.model, "test-model-resolved");
    // The fake server received the resolved request but the caller's
    // return value never carries the provider's API key anywhere.
    assert.ok(lastRequestBody, "the fake provider should have received the forwarded request");
    assert.equal(JSON.stringify(result).includes("server-only-test-key"), false);
  });

  test("logs a governance event for the brokered request without leaking prompt/response content", async () => {
    await brokerInferenceRequest("default", "manager-console-user", {
      source: "restaurant-platform:manager-console",
      system: "s",
      prompt: "p",
    });

    const log = getLog("default");
    const entry = log.find((e) => e.event.event_type === "inference_request_brokered");
    assert.ok(entry, "expected an inference_request_brokered governance event");
    assert.equal(entry!.event.details.source, "restaurant-platform:manager-console");
    assert.equal(entry!.event.details.ok, true);
    assert.equal(entry!.event.details.total_tokens, 20);
    assert.equal(JSON.stringify(entry!.event.details).includes("hello from the addin"), false);
  });

  test("a provider failure is logged and thrown, not silently swallowed", async () => {
    respondWith = { ok: false, status: 401 };

    await assert.rejects(() =>
      brokerInferenceRequest("default", "manager-console-user", {
        source: "restaurant-platform:manager-console",
        system: "s",
        prompt: "p",
      })
    );

    const log = getLog("default");
    const entry = log.find((e) => e.event.event_type === "inference_request_brokered");
    assert.ok(entry);
    assert.equal(entry!.event.details.ok, false);
  });
});
