import { test, expect } from "@playwright/test";
import { mockCommon } from "./helpers";

const CYCLES = { cycles: [{ cycle_id: "c-1", status: "completed", domains_run: ["ops", "growth"], actions_taken: 4, briefs_generated: 2, started_at: new Date().toISOString(), completed_at: new Date().toISOString() }] };
const EXPERIMENTS = { experiments: [{ experiment_id: "exp-1", name: "Pricing A/B test", hypothesis: "Lower price increases conversion", status: "running", domain: "growth", variant: "A/B", started_at: new Date().toISOString() }] };

test.describe("Autonomous Evolution page", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommon(page);
    await page.route("/api/v1/autonomous", r => r.fulfill({ json: CYCLES }));
    await page.route("/api/v1/autonomous/experiments", r => r.fulfill({ json: EXPERIMENTS }));
  });

  test("shows heading and Run cycle button", async ({ page }) => {
    await page.goto("/autonomous");
    await expect(page.getByText("Autonomous Evolution")).toBeVisible();
    await expect(page.getByRole("button", { name: "Run cycle" })).toBeVisible();
  });

  test("cycles tab shows completed cycle with domains and counts", async ({ page }) => {
    await page.goto("/autonomous");
    await expect(page.getByText(/Evolution Cycles \(1\)/)).toBeVisible();
    await expect(page.getByText("ops, growth")).toBeVisible();
    await expect(page.getByText("4 actions")).toBeVisible();
    await expect(page.getByText("2 briefs")).toBeVisible();
    await expect(page.getByText("completed")).toBeVisible();
  });

  test("empty cycles state shown when no cycles", async ({ page }) => {
    await page.route("/api/v1/autonomous", r => r.fulfill({ json: { cycles: [] } }));
    await page.goto("/autonomous");
    await expect(page.getByText("No evolution cycles run yet.")).toBeVisible();
  });

  test("Run cycle sends POST to /cycle/run", async ({ page }) => {
    let called = false;
    await page.route("/api/v1/autonomous/cycle/run", async r => { called = true; await r.fulfill({ json: { cycle_id: "c-2", status: "running" } }); });
    await page.goto("/autonomous");
    await page.getByRole("button", { name: "Run cycle" }).click();
    expect(called).toBe(true);
  });

  test("experiments tab shows existing experiment", async ({ page }) => {
    await page.goto("/autonomous");
    await page.getByRole("button", { name: /Experiments/ }).click();
    await expect(page.getByText("Pricing A/B test")).toBeVisible();
    await expect(page.getByText("Lower price increases conversion")).toBeVisible();
    await expect(page.getByText("Running")).toBeVisible();
  });

  test("create experiment sends POST with correct payload", async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null;
    await page.route("/api/v1/autonomous/experiments", async r => {
      if (r.request().method() === "POST") { capturedBody = JSON.parse(r.request().postData() ?? "{}"); await r.fulfill({ json: { experiment_id: "exp-2", status: "running" } }); }
      else await r.fulfill({ json: EXPERIMENTS });
    });
    await page.goto("/autonomous");
    await page.getByRole("button", { name: /Experiments/ }).click();
    await page.getByPlaceholder("Experiment name").fill("New experiment");
    await page.getByRole("button", { name: "Create" }).click();
    expect(capturedBody!.name).toBe("New experiment");
  });

  test("signals tab shows inject form", async ({ page }) => {
    await page.goto("/autonomous");
    await page.getByRole("button", { name: "Signals" }).click();
    await expect(page.getByText("Inject Signal")).toBeVisible();
    await expect(page.getByPlaceholder("e.g. customer_churn_rate")).toBeVisible();
  });

  test("Inject button disabled until name and value filled", async ({ page }) => {
    await page.goto("/autonomous");
    await page.getByRole("button", { name: "Signals" }).click();
    await expect(page.getByRole("button", { name: "Inject" })).toBeDisabled();
    await page.getByPlaceholder("e.g. customer_churn_rate").fill("churn");
    await expect(page.getByRole("button", { name: "Inject" })).toBeDisabled();
    await page.getByPlaceholder("e.g. 12.5").fill("8.5");
    await expect(page.getByRole("button", { name: "Inject" })).toBeEnabled();
  });

  test("Inject sends POST to /autonomous/signals", async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null;
    await page.route("/api/v1/autonomous/signals", async r => { capturedBody = JSON.parse(r.request().postData() ?? "{}"); await r.fulfill({ json: { ok: true } }); });
    await page.goto("/autonomous");
    await page.getByRole("button", { name: "Signals" }).click();
    await page.getByPlaceholder("e.g. customer_churn_rate").fill("churn_rate");
    await page.getByPlaceholder("e.g. 12.5").fill("9.2");
    await page.getByRole("button", { name: "Inject" }).click();
    expect(capturedBody!.name).toBe("churn_rate");
    expect(capturedBody!.value).toBe("9.2");
    await expect(page.getByText("Signal injected successfully.")).toBeVisible();
  });
});
