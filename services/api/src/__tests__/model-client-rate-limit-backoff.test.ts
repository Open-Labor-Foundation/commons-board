import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../lib/provider/bootstrap.js";
import { complete } from "../lib/model-client.js";

/**
 * Live evidence: concurrency=1 plus a fixed 1500ms inter-call pacing
 * *still* produced HTTP 429 on nearly every call, at about the same rate
 * as before pacing existed -- a fixed guessed delay wasn't the right
 * mechanism. This proves the real mechanism instead: complete() backs off
 * and retries specifically on a 429 response, with increasing delay,
 * rather than needing the exact right constant guessed in advance.
 */
describe("complete() rate-limit backoff", () => {
  let tempRoot: string;
  let server: Server;
  let baseUrl: string;
  let requestCount: number;
  let failFirstN: number;

  beforeEach(async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "model-client-backoff-test-"));
    process.env.CB_DATA_DIR = tempRoot;

    requestCount = 0;
    failFirstN = 0;
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        requestCount += 1;
        if (requestCount <= failFirstN) {
          res.writeHead(429, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "rate limited" } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
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
            api_key: "test-key",
            endpoint: baseUrl,
            options: {},
            concurrency_lanes: 4,
            concurrency_cost: 4,
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

  test("recovers from a 429 by backing off and retrying, without the caller ever seeing a failure", async () => {
    failFirstN = 2;
    const result = await complete("default", { system: "s", prompt: "p" });
    assert.equal(result.ok, true);
    assert.equal(result.text, "ok");
    assert.equal(requestCount, 3, "should have retried exactly twice after the initial 429s before succeeding");
  });

  test("gives up and returns the failure after exhausting backoff attempts", async () => {
    failFirstN = 999;
    const result = await complete("default", { system: "s", prompt: "p" });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /429/);
  });

  test("does not back off on a non-rate-limit failure", async () => {
    failFirstN = 0;
    server.close();
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        requestCount += 1;
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "internal error" } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a network address");
    const settingsDir = join(tempRoot, "settings");
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
            api_key: "test-key",
            endpoint: `http://127.0.0.1:${address.port}`,
            options: {},
            concurrency_lanes: 4,
            concurrency_cost: 4,
          },
        ],
        rbac: { grants: { admin: ["*"], operator: [], member: [], observer: [] } },
        feature_toggles: {},
        updated_at: new Date().toISOString(),
      }),
      "utf8"
    );

    const result = await complete("default", { system: "s", prompt: "p" });
    assert.equal(result.ok, false);
    assert.equal(requestCount, 1, "a non-429 failure must not trigger the rate-limit backoff/retry loop");
  });
});
