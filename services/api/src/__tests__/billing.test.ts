import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDataDir, removeTestDataDir } from "./helpers.js";
import { writeJsonAtomic } from "../lib/persistence.js";

const WS = "test-ws-billing";

async function getMetrics(ws: string): Promise<{
  totalRevenue: number;
  mrr: number;
  arr: number;
  activeCustomers: number;
  trialCustomers: number;
  churnedCustomers: number;
  eventCounts: Record<string, number>;
}> {
  const { readJson } = await import("../lib/persistence.js");

  type RevenueEvent = { id: string; eventName: string; amount: number; currency: string };
  type Customer = { id: string; status: "active" | "churned" | "trial"; mrr: number; currency: string };

  const INCOME_EVENTS = new Set(["checkout_completed", "payment_received", "invoice_paid"]);
  const events = readJson<RevenueEvent[]>(`billing-events/${ws}`, []);
  const customers = readJson<Customer[]>(`billing-customers/${ws}`, []);

  const totalRevenue = events.filter((e) => INCOME_EVENTS.has(e.eventName)).reduce((s, e) => s + e.amount, 0);
  const active = customers.filter((c) => c.status === "active");
  const mrr = active.reduce((s, c) => s + c.mrr, 0);
  const eventCounts: Record<string, number> = {};
  for (const e of events) eventCounts[e.eventName] = (eventCounts[e.eventName] ?? 0) + 1;

  return {
    totalRevenue,
    mrr,
    arr: mrr * 12,
    activeCustomers: active.length,
    trialCustomers: customers.filter((c) => c.status === "trial").length,
    churnedCustomers: customers.filter((c) => c.status === "churned").length,
    eventCounts
  };
}

describe("billing metrics", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestDataDir();
  });

  afterEach(() => {
    removeTestDataDir(dir);
  });

  test("empty billing has zero metrics", async () => {
    const m = await getMetrics(WS);
    assert.equal(m.totalRevenue, 0);
    assert.equal(m.mrr, 0);
    assert.equal(m.arr, 0);
    assert.equal(m.activeCustomers, 0);
  });

  test("totalRevenue only counts income event types", async () => {
    writeJsonAtomic(`billing-events/${WS}`, [
      { id: "e1", eventName: "checkout_completed", amount: 99, currency: "USD" },
      { id: "e2", eventName: "refund_issued", amount: 20, currency: "USD" },
      { id: "e3", eventName: "payment_received", amount: 200, currency: "USD" }
    ]);
    const m = await getMetrics(WS);
    assert.equal(m.totalRevenue, 299); // refund excluded
  });

  test("MRR is sum of active customer MRR values", async () => {
    writeJsonAtomic(`billing-customers/${WS}`, [
      { id: "c1", status: "active", mrr: 500, currency: "USD" },
      { id: "c2", status: "active", mrr: 300, currency: "USD" },
      { id: "c3", status: "churned", mrr: 100, currency: "USD" },
      { id: "c4", status: "trial", mrr: 0, currency: "USD" }
    ]);
    const m = await getMetrics(WS);
    assert.equal(m.mrr, 800);
    assert.equal(m.arr, 9600);
    assert.equal(m.activeCustomers, 2);
    assert.equal(m.churnedCustomers, 1);
    assert.equal(m.trialCustomers, 1);
  });

  test("eventCounts tallies each event type", async () => {
    writeJsonAtomic(`billing-events/${WS}`, [
      { id: "e1", eventName: "checkout_completed", amount: 50, currency: "USD" },
      { id: "e2", eventName: "checkout_completed", amount: 50, currency: "USD" },
      { id: "e3", eventName: "refund_issued", amount: 20, currency: "USD" }
    ]);
    const m = await getMetrics(WS);
    assert.equal(m.eventCounts.checkout_completed, 2);
    assert.equal(m.eventCounts.refund_issued, 1);
  });
});
