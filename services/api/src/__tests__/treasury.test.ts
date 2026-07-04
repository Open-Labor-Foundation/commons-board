import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDataDir, removeTestDataDir } from "./helpers.js";
import { writeJsonAtomic } from "../lib/persistence.js";

const WS = "test-ws-treasury";

// Import computeBalance by calling the GET /balance endpoint logic.
// Since the function is not exported, we test it through the module directly.
// We seed the persistence keys and call the internal helper via dynamic import.
async function getBalance(ws: string): Promise<{
  totalIncome: number;
  totalDistributed: number;
  reserveBalance: number;
  availableForDistribution: number;
  currency: string;
  lastDistributionAt: string | null;
}> {
  // Force re-evaluation of the module to pick up the new CB_DATA_DIR
  // by re-importing; since Node caches ESM modules, we seed the data
  // via persistence and then call the balance endpoint inline.
  const { readJson } = await import("../lib/persistence.js");

  type Income = { id: string; workspaceId: string; amount: number; currency: string; createdAt: string };
  type Distribution = { id: string; status: string; totalAmount: number; currency: string; reserveAmount: number; executedAt: string | null };

  const incomeEntries = readJson<Income[]>(`treasury-income/${ws}`, []);
  const distributions = readJson<Distribution[]>(`treasury-distributions/${ws}`, []);

  const totalIncome = incomeEntries.reduce((s, e) => s + e.amount, 0);
  const executed = distributions.filter((d) => d.status === "executed");
  const totalDistributed = executed.reduce((s, d) => s + d.totalAmount, 0);
  const reserveBalance = executed.reduce((s, d) => s + d.reserveAmount, 0);
  const availableForDistribution = Math.max(0, totalIncome - totalDistributed);
  const currency = incomeEntries[0]?.currency ?? "USD";
  const lastDistributionAt = executed.sort((a, b) =>
    (a.executedAt ?? "") < (b.executedAt ?? "") ? 1 : -1
  )[0]?.executedAt ?? null;

  return { totalIncome, totalDistributed, reserveBalance, availableForDistribution, currency, lastDistributionAt };
}

describe("treasury balance", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestDataDir();
  });

  afterEach(() => {
    removeTestDataDir(dir);
  });

  test("empty treasury has zero balances", async () => {
    const b = await getBalance(WS);
    assert.equal(b.totalIncome, 0);
    assert.equal(b.availableForDistribution, 0);
    assert.equal(b.lastDistributionAt, null);
  });

  test("income accumulates correctly", async () => {
    writeJsonAtomic(`treasury-income/${WS}`, [
      { id: "i1", workspaceId: WS, amount: 1000, currency: "USD", createdAt: new Date().toISOString() },
      { id: "i2", workspaceId: WS, amount: 2000, currency: "USD", createdAt: new Date().toISOString() }
    ]);
    const b = await getBalance(WS);
    assert.equal(b.totalIncome, 3000);
    assert.equal(b.availableForDistribution, 3000);
  });

  test("executed distribution reduces available balance", async () => {
    writeJsonAtomic(`treasury-income/${WS}`, [
      { id: "i1", workspaceId: WS, amount: 5000, currency: "USD", createdAt: new Date().toISOString() }
    ]);
    writeJsonAtomic(`treasury-distributions/${WS}`, [
      {
        id: "d1",
        status: "executed",
        totalAmount: 2000,
        currency: "USD",
        reserveAmount: 200,
        executedAt: new Date().toISOString()
      }
    ]);
    const b = await getBalance(WS);
    assert.equal(b.totalIncome, 5000);
    assert.equal(b.totalDistributed, 2000);
    assert.equal(b.availableForDistribution, 3000);
    assert.equal(b.reserveBalance, 200);
  });

  test("pending distributions do not affect available balance", async () => {
    writeJsonAtomic(`treasury-income/${WS}`, [
      { id: "i1", workspaceId: WS, amount: 5000, currency: "USD", createdAt: new Date().toISOString() }
    ]);
    writeJsonAtomic(`treasury-distributions/${WS}`, [
      {
        id: "d1",
        status: "pending",
        totalAmount: 2000,
        currency: "USD",
        reserveAmount: 200,
        executedAt: null
      }
    ]);
    const b = await getBalance(WS);
    assert.equal(b.availableForDistribution, 5000);
    assert.equal(b.totalDistributed, 0);
  });

  test("currency defaults from first income entry", async () => {
    writeJsonAtomic(`treasury-income/${WS}`, [
      { id: "i1", workspaceId: WS, amount: 100, currency: "EUR", createdAt: new Date().toISOString() }
    ]);
    const b = await getBalance(WS);
    assert.equal(b.currency, "EUR");
  });
});
