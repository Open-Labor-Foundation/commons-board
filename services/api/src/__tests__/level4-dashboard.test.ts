import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDataDir, removeTestDataDir } from "./helpers.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";
import { computeLevel4Dashboard } from "../routes/level4.js";

const WS = "test-ws-level4";

type Level4Action = {
  id: string;
  type: string;
  status: "pending" | "executing" | "completed" | "failed" | "blocked";
  createdAt: string;
  payload: Record<string, unknown>;
};

describe("computeLevel4Dashboard", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestDataDir();
  });

  afterEach(() => {
    removeTestDataDir(dir);
  });

  test("returns zero counts when workspace has no data", () => {
    const dash = computeLevel4Dashboard(WS);
    assert.equal(dash.actions.total, 0);
    assert.equal(dash.actions.pending, 0);
    assert.equal(dash.outreach.prospects, 0);
    assert.equal(dash.outreach.campaigns, 0);
    assert.equal(dash.provisioning.status, "pending");
  });

  test("counts actions by status correctly", () => {
    const actions: Level4Action[] = [
      { id: "a1", type: "provision_dns", status: "completed", createdAt: new Date().toISOString(), payload: {} },
      { id: "a2", type: "deploy_landing", status: "pending", createdAt: new Date().toISOString(), payload: {} },
      { id: "a3", type: "setup_stripe", status: "pending", createdAt: new Date().toISOString(), payload: {} },
      { id: "a4", type: "send_outreach", status: "failed", createdAt: new Date().toISOString(), payload: {} }
    ];
    writeJsonAtomic(`level4-actions/${WS}`, actions);

    const dash = computeLevel4Dashboard(WS);
    assert.equal(dash.actions.total, 4);
    assert.equal(dash.actions.pending, 2);
    assert.equal(dash.actions.completed, 1);
    assert.equal(dash.actions.failed, 1);
  });

  test("counts outreach prospects", () => {
    const prospects = [
      { email: "a@x.com", status: "pending" },
      { email: "b@x.com", status: "sent" },
      { email: "c@x.com", status: "interested" }
    ];
    writeJsonAtomic(`outreach-prospects/${WS}`, prospects);

    const dash = computeLevel4Dashboard(WS);
    assert.equal(dash.outreach.prospects, 3);
  });

  test("outreach tracks interested reply count", () => {
    const replies = [
      { classification: "interested" },
      { classification: "not_now" },
      { classification: "interested" },
      { classification: "unsubscribe" }
    ];
    writeJsonAtomic(`outreach-replies/${WS}`, replies);

    const dash = computeLevel4Dashboard(WS);
    assert.equal(dash.outreach.interestedCount, 2);
  });

  test("provisioning status reflects persisted state", () => {
    writeJsonAtomic(`provisioning-status/${WS}`, { status: "dns_live" });
    const dash = computeLevel4Dashboard(WS);
    assert.equal(dash.provisioning.status, "dns_live");
  });

  test("payment checkout URL is reported when configured", () => {
    writeJsonAtomic(`payment-setup/${WS}`, { checkout_url: "https://checkout.example.com/pay/price_123" });
    const dash = computeLevel4Dashboard(WS);
    assert.equal(dash.payments.checkoutConfigured, true);
    assert.equal(dash.payments.checkoutUrl, "https://checkout.example.com/pay/price_123");
  });
});
