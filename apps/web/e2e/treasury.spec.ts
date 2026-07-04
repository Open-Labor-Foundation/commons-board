import { test, expect } from "@playwright/test";
import { mockCommon } from "./helpers";

const BALANCE = { totalIncome: 50000, totalDistributed: 20000, totalContributions: 5000, reserveBalance: 10000, availableForDistribution: 25000, currency: "USD", lastDistributionAt: new Date().toISOString() };
const INCOME = { records: [{ id: "inc-1", amount: 5000, currency: "USD", description: "Membership dues Q2", source: "membership", period: "2026-Q2", createdAt: new Date().toISOString() }] };
const DISTRIBUTIONS = { distributions: [{ id: "dist-1", amount: 2500, currency: "USD", description: "Worker stipend", status: "pending", createdAt: new Date().toISOString() }] };
const CONTRIBUTIONS = { contributions: [{ id: "con-1", contributor: "Alice", amount: 1000, currency: "USD", description: "Labor hours", createdAt: new Date().toISOString() }] };

test.describe("Treasury page", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommon(page);
    await page.route("/api/v1/treasury/balance", r => r.fulfill({ json: BALANCE }));
    await page.route("/api/v1/treasury/income", r => r.fulfill({ json: INCOME }));
    await page.route("/api/v1/treasury/distributions", r => r.fulfill({ json: DISTRIBUTIONS }));
    await page.route("/api/v1/treasury/contributions", r => r.fulfill({ json: CONTRIBUTIONS }));
  });

  test("shows Treasury heading and balance stats", async ({ page }) => {
    await page.goto("/treasury");
    await expect(page.getByText("Treasury")).toBeVisible();
    await expect(page.getByText("$50,000")).toBeVisible();
    await expect(page.getByText("$25,000")).toBeVisible();
    await expect(page.getByText("$20,000")).toBeVisible();
    await expect(page.getByText("$10,000")).toBeVisible();
  });

  test("income tab shows existing income records", async ({ page }) => {
    await page.goto("/treasury");
    await expect(page.getByText(/Income \(1\)/)).toBeVisible();
    await expect(page.getByText("Membership dues Q2")).toBeVisible();
    await expect(page.getByText("membership", { exact: true })).toBeVisible();
    await expect(page.getByText("$5,000").first()).toBeVisible();
  });

  test("Record income button sends POST", async ({ page }) => {
    let body: Record<string, unknown> | null = null;
    await page.route("/api/v1/treasury/income", async r => {
      if (r.request().method() === "POST") { body = JSON.parse(r.request().postData() ?? "{}"); await r.fulfill({ json: { id: "inc-2" } }); }
      else await r.fulfill({ json: INCOME });
    });
    await page.goto("/treasury");
    await page.getByPlaceholder("Membership dues, grant, service fee…").fill("New grant");
    await page.locator("input[type=number]").first().fill("10000");
    await page.getByRole("button", { name: "Record" }).click();
    expect(body!.description).toBe("New grant");
    expect(body!.amount).toBe(10000);
  });

  test("distributions tab shows pending distribution with Execute button", async ({ page }) => {
    await page.goto("/treasury");
    await page.getByRole("button", { name: /Distributions/ }).click();
    await expect(page.getByText("Worker stipend")).toBeVisible();
    await expect(page.getByText("$2,500")).toBeVisible();
    await expect(page.getByText("pending")).toBeVisible();
    await expect(page.getByRole("button", { name: "Execute" })).toBeVisible();
  });

  test("Execute sends POST to /distributions/:id/execute", async ({ page }) => {
    let called = false;
    await page.route("/api/v1/treasury/distributions/dist-1/execute", async r => { called = true; await r.fulfill({ json: { ok: true } }); });
    await page.goto("/treasury");
    await page.getByRole("button", { name: /Distributions/ }).click();
    await page.getByRole("button", { name: "Execute" }).click();
    expect(called).toBe(true);
  });

  test("contributions tab shows member contribution", async ({ page }) => {
    await page.goto("/treasury");
    await page.getByRole("button", { name: /Contributions/ }).click();
    await expect(page.getByText("Alice")).toBeVisible();
    await expect(page.getByText("$1,000")).toBeVisible();
    await expect(page.getByText("Labor hours")).toBeVisible();
  });

  test("Record contribution sends POST", async ({ page }) => {
    let body: Record<string, unknown> | null = null;
    await page.route("/api/v1/treasury/contributions", async r => {
      if (r.request().method() === "POST") { body = JSON.parse(r.request().postData() ?? "{}"); await r.fulfill({ json: { id: "con-2" } }); }
      else await r.fulfill({ json: CONTRIBUTIONS });
    });
    await page.goto("/treasury");
    await page.getByRole("button", { name: /Contributions/ }).click();
    await page.getByPlaceholder("Member name or ID").fill("Bob");
    await page.locator("input[type=number]").first().fill("500");
    await page.getByRole("button", { name: "Record" }).click();
    expect(body!.contributor).toBe("Bob");
    expect(body!.amount).toBe(500);
  });
});
