import { test, expect } from "@playwright/test";
import { mockCommon } from "./helpers";

const CADENCE = { cadence: { last_run_at: new Date().toISOString(), next_run_at: null, run_count: 3, status: "idle" }, runs: [{ run_id: "run-1", status: "completed", brief_type: "executive", domain: "ops", started_at: new Date().toISOString(), completed_at: new Date().toISOString() }] };
const TEMPLATES = { templates: [{ template_id: "tmpl-1", name: "Weekly Exec", brief_type: "executive", domain: "ops", schedule: "0 9 * * 1", enabled: true }] };

test.describe("Cadence page", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommon(page);
    await page.route("/api/v1/cadence", r => r.fulfill({ json: CADENCE }));
    await page.route("/api/v1/brief-templates", r => r.fulfill({ json: TEMPLATES }));
  });

  test("shows cadence stats and recent runs", async ({ page }) => {
    await page.goto("/cadence");
    await expect(page.getByText("Cadence")).toBeVisible();
    await expect(page.getByText("Last run")).toBeVisible();
    await expect(page.getByText("Total runs")).toBeVisible();
    await expect(page.getByText("3")).toBeVisible();
  });

  test("shows recent runs in overview tab", async ({ page }) => {
    await page.goto("/cadence");
    await expect(page.getByText("Executive").first()).toBeVisible();
    await expect(page.getByText("completed").first()).toBeVisible();
  });

  test("Run now sends POST to /api/v1/cadence/run", async ({ page }) => {
    let called = false;
    await page.route("/api/v1/cadence/run", async r => {
      called = true;
      await r.fulfill({ json: { run_id: "run-2", status: "running" } });
    });
    await page.goto("/cadence");
    await page.getByRole("button", { name: "Run now" }).click();
    expect(called).toBe(true);
  });

  test("templates tab shows existing templates", async ({ page }) => {
    await page.goto("/cadence");
    await page.getByRole("button", { name: /Templates/ }).click();
    await expect(page.getByText("Weekly Exec")).toBeVisible();
    await expect(page.getByText("0 9 * * 1")).toBeVisible();
    await expect(page.getByText("Enabled")).toBeVisible();
  });

  test("adding a template sends POST with correct payload", async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null;
    await page.route("/api/v1/brief-templates", async r => {
      if (r.request().method() === "POST") {
        capturedBody = JSON.parse(r.request().postData() ?? "{}");
        await r.fulfill({ json: { template_id: "tmpl-2", name: "Daily Ops", brief_type: "executive", domain: "ops", enabled: true } });
      } else {
        await r.fulfill({ json: TEMPLATES });
      }
    });
    await page.goto("/cadence");
    await page.getByRole("button", { name: /Templates/ }).click();
    await page.getByRole("button", { name: "+ Add" }).click();
    await page.getByPlaceholder("Template name").fill("Daily Ops");
    await page.getByRole("button", { name: "Save" }).click();
    expect(capturedBody!.name).toBe("Daily Ops");
    expect(capturedBody!.enabled).toBe(true);
  });

  test("toggle template sends PUT request", async ({ page }) => {
    let putCalled = false;
    await page.route("/api/v1/brief-templates/tmpl-1", async r => {
      putCalled = true;
      await r.fulfill({ json: { ...TEMPLATES.templates[0], enabled: false } });
    });
    await page.goto("/cadence");
    await page.getByRole("button", { name: /Templates/ }).click();
    await page.getByRole("button", { name: "Enabled" }).click();
    expect(putCalled).toBe(true);
  });
});
