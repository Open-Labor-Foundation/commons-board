import { test, expect } from "@playwright/test";
import { mockCommon } from "./helpers";

const STATE = {
  runs: [
    { run_id: "run-1", initiated_by: "admin", sim_mode: false, status: "completed", action_count: 7, blocked_count: 1, approval_count: 2, auto_count: 4, initiated_at: new Date().toISOString(), completed_at: new Date().toISOString() },
  ],
  total: 1,
};

test.describe("Execution page", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommon(page);
    await page.route("/api/v1/execution/runs", r => r.fulfill({ json: STATE }));
  });

  test("shows stats and recent runs", async ({ page }) => {
    await page.goto("/execution");
    await expect(page.getByText("Execution Runtime")).toBeVisible();
    await expect(page.getByText("Total runs")).toBeVisible();
    await expect(page.getByText("Run by admin")).toBeVisible();
    await expect(page.getByText("completed")).toBeVisible();
  });

  test("Execute button is disabled until title is entered", async ({ page }) => {
    await page.goto("/execution");
    await expect(page.getByRole("button", { name: "Execute" })).toBeDisabled();
    await page.getByPlaceholder("e.g. Generate weekly finance report").fill("My task");
    await expect(page.getByRole("button", { name: "Execute" })).toBeEnabled();
  });

  test("Execute sends POST with correct payload", async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null;
    await page.route("/api/v1/execution/run", async r => {
      capturedBody = JSON.parse(r.request().postData() ?? "{}");
      await r.fulfill({ json: { run_id: "run-2", status: "running" } });
    });
    await page.goto("/execution");
    await page.getByPlaceholder("e.g. Generate weekly finance report").fill("Weekly report");
    await page.getByRole("button", { name: "Execute" }).click();
    expect(capturedBody!.title).toBe("Weekly report");
    expect(capturedBody!.action_type).toBeDefined();
  });

  test("shows error on invalid JSON payload", async ({ page }) => {
    await page.goto("/execution");
    await page.getByPlaceholder("e.g. Generate weekly finance report").fill("My task");
    await page.getByPlaceholder('{"key": "value"}').fill("not json");
    await page.getByRole("button", { name: "Execute" }).click();
    await expect(page.getByText(/Payload must be valid JSON/)).toBeVisible();
  });

  test("expanding a run shows run_id details", async ({ page }) => {
    await page.goto("/execution");
    await page.getByText("Run by admin").click();
    await expect(page.getByText("run_id: run-1")).toBeVisible();
  });
});
