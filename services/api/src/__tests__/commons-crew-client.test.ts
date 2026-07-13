import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { registerChair } from "../lib/commons-crew-client.js";

describe("commons-crew-client registerChair", () => {
  let server: Server;
  let baseUrl: string;
  let lastRequest: { url?: string; method?: string; authorization?: string; body?: unknown } | null;
  let responseStatus: number;
  let responseBody: unknown;

  beforeEach(async () => {
    lastRequest = null;
    responseStatus = 201;
    responseBody = { session: { id: "session-1" }, run: { id: "run-1" } };

    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        lastRequest = {
          url: req.url,
          method: req.method,
          authorization: req.headers.authorization,
          body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined
        };
        res.writeHead(responseStatus, { "content-type": "application/json" });
        res.end(JSON.stringify(responseBody));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a network address");
    baseUrl = `http://127.0.0.1:${address.port}`;
    process.env.CB_COMMONS_CREW_URL = baseUrl;
  });

  afterEach(async () => {
    delete process.env.CB_COMMONS_CREW_URL;
    delete process.env.CB_COMMONS_CREW_TOKEN;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("returns null when CB_COMMONS_CREW_URL is not configured", async () => {
    delete process.env.CB_COMMONS_CREW_URL;
    const result = await registerChair({ orgContext: "acme", chairRole: "finance", surface: "web", title: "Finance Chair" });
    assert.equal(result, null);
    assert.equal(lastRequest, null);
  });

  test("posts to /api/chairs and returns the run/session ids on success", async () => {
    const result = await registerChair({ orgContext: "acme", chairRole: "finance", surface: "web", title: "Finance Chair" });
    assert.deepEqual(result, { runId: "run-1", sessionId: "session-1" });
    assert.equal(lastRequest?.url, "/api/chairs");
    assert.equal(lastRequest?.method, "POST");
    assert.deepEqual(lastRequest?.body, { orgContext: "acme", chairRole: "finance", surface: "web", title: "Finance Chair" });
  });

  test("sends a bearer token when CB_COMMONS_CREW_TOKEN is set", async () => {
    process.env.CB_COMMONS_CREW_TOKEN = "test-token";
    await registerChair({ orgContext: "acme", chairRole: "hr", surface: "web", title: "HR Chair" });
    assert.equal(lastRequest?.authorization, "Bearer test-token");
  });

  test("returns null (not a throw) on a non-2xx response", async () => {
    responseStatus = 422;
    responseBody = { error: { code: "invalid_chair_registration", message: "not a recognized chair role" } };
    const result = await registerChair({ orgContext: "acme", chairRole: "finance", surface: "web", title: "Finance Chair" });
    assert.equal(result, null);
  });

  test("returns null (not a throw) when the server is unreachable", async () => {
    process.env.CB_COMMONS_CREW_URL = "http://127.0.0.1:1";
    const result = await registerChair({ orgContext: "acme", chairRole: "finance", surface: "web", title: "Finance Chair" });
    assert.equal(result, null);
  });
});
