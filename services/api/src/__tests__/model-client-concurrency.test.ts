import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../lib/provider/bootstrap.js";
import { complete, MIN_CALL_SPACING_MS } from "../lib/model-client.js";

/**
 * Proves the actual bug this was chasing: getProviderConcurrency/mapConcurrent
 * were only ever used *locally* by each caller (the interview flow,
 * motherboard-chat.ts, agent-job-runner.ts) to bound its own batch --
 * nothing coordinated across callers, so two unrelated concurrent requests
 * could each correctly stay within their own local bound and still exceed
 * the provider's real, shared, global concurrency budget together. This
 * test drives concurrent complete() calls from what look like two
 * unrelated callers (no shared local mapConcurrent between them) and
 * proves the server-observed concurrency never exceeds maxParallel,
 * because complete() itself now gates on a shared, provider-keyed
 * semaphore -- the one choke point every call actually passes through.
 */
describe("complete() global concurrency gate", () => {
  let tempRoot: string;
  let server: Server;
  let baseUrl: string;
  let inFlight: number;
  let maxObservedInFlight: number;
  let requestStartTimes: number[];
  const RESPONSE_DELAY_MS = 60;

  beforeEach(async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "model-client-concurrency-test-"));
    process.env.CB_DATA_DIR = tempRoot;

    inFlight = 0;
    maxObservedInFlight = 0;
    requestStartTimes = [];
    server = createServer((req, res) => {
      inFlight += 1;
      maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
      requestStartTimes.push(Date.now());
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        setTimeout(() => {
          inFlight -= 1;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
        }, RESPONSE_DELAY_MS);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a network address");
    baseUrl = `http://127.0.0.1:${address.port}`;

    const settingsDir = join(tempRoot, "settings");
    mkdirSync(settingsDir, { recursive: true });
    // Matches the real reported deployment shape: a 4-lane key with a
    // 4-lane-cost model is exactly 1 real concurrent call, not 4.
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

  test("never exceeds maxParallel=1 even across calls with no shared local concurrency limiter", async () => {
    // Two "unrelated callers" -- neither awaits the other, neither shares
    // a mapConcurrent batch -- firing five calls total, same shape as one
    // request from the interview flow overlapping with an unrelated chat
    // or cadence request.
    const callerA = Promise.all([1, 2, 3].map(() => complete("default", { system: "s", prompt: "p" })));
    const callerB = Promise.all([1, 2].map(() => complete("default", { system: "s", prompt: "p" })));

    const [resultsA, resultsB] = await Promise.all([callerA, callerB]);

    assert.equal(resultsA.length, 3);
    assert.equal(resultsB.length, 2);
    for (const r of [...resultsA, ...resultsB]) {
      assert.equal(r.ok, true);
    }
    assert.equal(maxObservedInFlight, 1, "the provider must never see more than 1 concurrent request for a 4-lane key with 4-lane cost");
  });

  test("paces consecutive calls, not just caps overlap -- the real live failure even at strict concurrency=1", async () => {
    // Real bug: with only the concurrency cap, the moment one call's
    // response landed, the next queued call fired immediately (zero gap)
    // and the provider 429'd anyway, despite never having more than 1
    // request literally in flight. Concurrency and request rate are
    // different constraints.
    await Promise.all([1, 2, 3].map(() => complete("default", { system: "s", prompt: "p" })));

    assert.equal(requestStartTimes.length, 3);
    for (let i = 1; i < requestStartTimes.length; i++) {
      const gap = requestStartTimes[i] - requestStartTimes[i - 1];
      assert.ok(
        gap >= MIN_CALL_SPACING_MS - 50, // small tolerance for timer jitter
        `expected at least ~${MIN_CALL_SPACING_MS}ms between consecutive call starts, got ${gap}ms`
      );
    }
  });

  test("allows real concurrency up to maxParallel when the key supports more than one lane", async () => {
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
            endpoint: baseUrl,
            options: {},
            concurrency_lanes: 4,
            concurrency_cost: 1,
          },
        ],
        rbac: { grants: { admin: ["*"], operator: [], member: [], observer: [] } },
        feature_toggles: {},
        updated_at: new Date().toISOString(),
      }),
      "utf8"
    );

    await Promise.all([1, 2, 3, 4].map(() => complete("default", { system: "s", prompt: "p" })));
    assert.ok(maxObservedInFlight > 1, "a 4-lane key with 1-lane cost should allow real concurrency, not force serialization");
    assert.ok(maxObservedInFlight <= 4, "must never exceed the real maxParallel even when it's greater than 1");
  });
});
