import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../lib/provider/bootstrap.js";
import { completeJsonWithRetry, ModelJsonError } from "../lib/model-json.js";

/**
 * Hermetic: no real provider involved. A local HTTP server stands in for
 * the hosted-api provider (Featherless-shaped /chat/completions), driven
 * entirely by real settings written to a real, isolated CB_DATA_DIR --
 * the actual code path completeText/complete() reads, not a mocked module.
 *
 * Exists to prove the retry-on-malformed-response behavior this function
 * was added for: live testing against a real Featherless key repeatedly
 * produced responses with no parseable JSON (truncated, wrapped in stray
 * prose), which every call site previously treated identically to "no
 * provider configured" -- silently falling back with zero visibility.
 */
describe("completeJsonWithRetry", () => {
  let tempRoot: string;
  let server: Server;
  let baseUrl: string;
  let responses: string[];
  let requestCount: number;

  beforeEach(async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "model-json-test-"));
    process.env.CB_DATA_DIR = tempRoot;

    requestCount = 0;
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const content = responses[requestCount] ?? responses[responses.length - 1];
        requestCount += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content } }] }));
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

  const isValidPayload = (parsed: unknown): parsed is { ok: true } =>
    typeof parsed === "object" && parsed !== null && (parsed as { ok?: boolean }).ok === true;

  test("succeeds on the first attempt when the response is valid JSON", async () => {
    responses = ['{"ok": true}'];
    const result = await completeJsonWithRetry("default", "system", "prompt", { max_tokens: 100, temperature: 0.1 }, /\{[\s\S]*\}/, isValidPayload);
    assert.deepEqual(result, { ok: true });
    assert.equal(requestCount, 1);
  });

  test("retries once on a malformed first response and succeeds on the second", async () => {
    responses = ["this is not json at all, just prose", '{"ok": true}'];
    const result = await completeJsonWithRetry("default", "system", "prompt", { max_tokens: 100, temperature: 0.1 }, /\{[\s\S]*\}/, isValidPayload);
    assert.deepEqual(result, { ok: true });
    assert.equal(requestCount, 2);
  });

  test("retries once on a response that parses but fails validation", async () => {
    responses = ['{"ok": false}', '{"ok": true}'];
    const result = await completeJsonWithRetry("default", "system", "prompt", { max_tokens: 100, temperature: 0.1 }, /\{[\s\S]*\}/, isValidPayload);
    assert.deepEqual(result, { ok: true });
    assert.equal(requestCount, 2);
  });

  test("throws ModelJsonError after exhausting all attempts, never silently succeeding with garbage", async () => {
    responses = ["prose one", "prose two"];
    await assert.rejects(
      () => completeJsonWithRetry("default", "system", "prompt", { max_tokens: 100, temperature: 0.1 }, /\{[\s\S]*\}/, isValidPayload),
      (err: unknown) => {
        assert.ok(err instanceof ModelJsonError);
        assert.equal(err.attempts, 2);
        return true;
      }
    );
    assert.equal(requestCount, 2);
  });

  test("strips <think> blocks before extracting JSON", async () => {
    responses = ['<think>reasoning about the answer</think>\n{"ok": true}'];
    const result = await completeJsonWithRetry("default", "system", "prompt", { max_tokens: 100, temperature: 0.1 }, /\{[\s\S]*\}/, isValidPayload);
    assert.deepEqual(result, { ok: true });
    assert.equal(requestCount, 1);
  });

  test("extracts JSON wrapped in a markdown code fence", async () => {
    responses = ['```json\n{"ok": true}\n```'];
    const result = await completeJsonWithRetry("default", "system", "prompt", { max_tokens: 100, temperature: 0.1 }, /\{[\s\S]*\}/, isValidPayload);
    assert.deepEqual(result, { ok: true });
    assert.equal(requestCount, 1);
  });
});
