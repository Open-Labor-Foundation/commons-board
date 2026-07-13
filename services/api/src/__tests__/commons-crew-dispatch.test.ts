import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { proposeDispatchToChair, submitDispatchDecision } from "../lib/commons-crew-client.js";

/**
 * The core safety property under test: proposeDispatchToChair must NEVER
 * call /api/approvals/:id/decision or /api/actions/:id/execute -- those are
 * real-world-impact endpoints that require a genuine human decision.
 * requestLog records every call the client makes so each test can assert
 * exactly which endpoints were (and were not) hit.
 */
describe("commons-crew-client dispatch (propose + decision)", () => {
  let server: Server;
  let baseUrl: string;
  let requestLog: Array<{ method: string; url: string; body: unknown }>;
  let pendingApprovalOnRun: { id: string; taskId: string; status: string } | null;

  beforeEach(async () => {
    requestLog = [];
    pendingApprovalOnRun = { id: "approval-seeded", taskId: "task-1", status: "pending" };

    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
        const url = req.url ?? "";
        const method = req.method ?? "";
        requestLog.push({ method, url, body });

        if (method === "GET" && /^\/api\/runs\/[^/]+$/.test(url)) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            run: { id: "run-1", workItemId: "work-item-1" },
            approvals: pendingApprovalOnRun ? [pendingApprovalOnRun] : []
          }));
          return;
        }
        if (method === "POST" && /^\/api\/runs\/[^/]+\/delegation-approvals$/.test(url)) {
          const fresh = { id: "approval-fresh", taskId: "task-1", status: "pending" };
          pendingApprovalOnRun = fresh;
          res.writeHead(201, { "content-type": "application/json" });
          res.end(JSON.stringify(fresh));
          return;
        }
        if (method === "POST" && url === "/api/actions/proposals") {
          res.writeHead(201, { "content-type": "application/json" });
          res.end(JSON.stringify({ id: "proposal-1" }));
          return;
        }
        if (method === "POST" && /^\/api\/approvals\/[^/]+\/decision$/.test(url)) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id: pendingApprovalOnRun?.id, status: body.decision }));
          return;
        }
        if (method === "POST" && /^\/api\/actions\/[^/]+\/execute$/.test(url)) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id: "execution-1", outcome: "child_run_delegated" }));
          return;
        }
        if (method === "GET" && /^\/api\/runs\/[^/]+\/events$/.test(url)) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            contract: { version: "1" },
            events: [{ eventType: "delegation.child_created", payload: { childRunId: "child-run-1", layer: "director" } }]
          }));
          return;
        }
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "no route" }));
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

  test("proposeDispatchToChair uses the already-pending approval and never decides or executes", async () => {
    const result = await proposeDispatchToChair({ runId: "run-1", workDescription: "do the thing" });
    assert.deepEqual(result, { approvalId: "approval-seeded", proposalId: "proposal-1", taskId: "task-1", runId: "run-1" });

    const hitDecision = requestLog.some((r) => /\/api\/approvals\/.+\/decision/.test(r.url));
    const hitExecute = requestLog.some((r) => /\/api\/actions\/.+\/execute/.test(r.url));
    assert.equal(hitDecision, false, "proposeDispatchToChair must never call the decision endpoint");
    assert.equal(hitExecute, false, "proposeDispatchToChair must never call the execute endpoint");
  });

  test("proposeDispatchToChair requests a fresh approval when none is pending", async () => {
    pendingApprovalOnRun = null;
    const result = await proposeDispatchToChair({ runId: "run-1", workDescription: "do the thing" });
    assert.equal(result?.approvalId, "approval-fresh");
    assert.ok(requestLog.some((r) => r.method === "POST" && /delegation-approvals$/.test(r.url)));
  });

  test("proposeDispatchToChair's proposal targetRef carries the work description", async () => {
    await proposeDispatchToChair({ runId: "run-1", workDescription: "quarterly budget review" });
    const proposalCall = requestLog.find((r) => r.url === "/api/actions/proposals");
    assert.equal((proposalCall?.body as { targetRef?: string })?.targetRef, "quarterly budget review");
    assert.equal((proposalCall?.body as { toolId?: string })?.toolId, "delegate_to_child");
    assert.equal((proposalCall?.body as { actionClass?: string })?.actionClass, "class_c");
  });

  test("proposeDispatchToChair returns null when CB_COMMONS_CREW_URL is not configured", async () => {
    delete process.env.CB_COMMONS_CREW_URL;
    const result = await proposeDispatchToChair({ runId: "run-1", workDescription: "do the thing" });
    assert.equal(result, null);
    assert.equal(requestLog.length, 0);
  });

  test("submitDispatchDecision requires an explicit decision and relays exactly that decision", async () => {
    const approved = await submitDispatchDecision({
      approvalId: "approval-seeded",
      proposalId: "proposal-1",
      runId: "run-1",
      decision: "approved",
      actorUserId: "user-42"
    });
    assert.equal(approved?.decision, "approved");
    assert.equal(approved?.childRunId, "child-run-1");
    assert.equal(approved?.layer, "director");

    const decisionCall = requestLog.find((r) => /\/api\/approvals\/.+\/decision/.test(r.url));
    assert.equal((decisionCall?.body as { decision?: string })?.decision, "approved");
    // commons-crew has no concept of commons-board's per-org actor identity yet
    // (workspace_membership_required rejects anything but its own seeded member) --
    // see the COMMONS_CREW_DEFAULT_ACTOR comment in commons-crew-client.ts.
    assert.equal((decisionCall?.body as { actorUserId?: string })?.actorUserId, "user_primary");
    assert.ok(requestLog.some((r) => /\/api\/actions\/.+\/execute/.test(r.url)), "approved decisions must execute");
  });

  test("submitDispatchDecision with decision 'denied' never calls execute", async () => {
    const denied = await submitDispatchDecision({
      approvalId: "approval-seeded",
      proposalId: "proposal-1",
      runId: "run-1",
      decision: "denied",
      actorUserId: "user-42"
    });
    assert.equal(denied?.decision, "denied");
    assert.equal(denied?.childRunId, null);

    const hitExecute = requestLog.some((r) => /\/api\/actions\/.+\/execute/.test(r.url));
    assert.equal(hitExecute, false, "a denied decision must never execute");
  });
});
