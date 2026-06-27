import { test, expect } from "@playwright/test";
import { mockCommon } from "./helpers";

const BI_HEALTH = {
  overall_score: 74,
  trend: "up",
  domain_scores: { ops: 82, finance: 68, growth: 71 },
  capability_count: 12,
  dashboard_count: 3,
  domain_count: 3,
};
const OBS_RUNS = {
  runs: [{ run_id: "r-1", status: "completed", initiated_at: new Date().toISOString(), action_count: 5 }],
  total: 1,
};
const OBS_CADENCE = { last_daily_at: new Date().toISOString(), last_weekly_at: new Date().toISOString(), last_monthly_at: null };
const EVENTS = { events: [{ event_id: "ev-1", type: "user_signup", domain: "growth", summary: "New user signed up via referral", actor: "growth-agent", created_at: new Date().toISOString() }] };

test.describe("BI & Observability page", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommon(page);
    await page.route("/api/v1/bi/health", r => r.fulfill({ json: BI_HEALTH }));
    await page.route("/api/v1/obs/execution-runs", r => r.fulfill({ json: OBS_RUNS }));
    await page.route("/api/v1/obs/last-cadence", r => r.fulfill({ json: OBS_CADENCE }));
    await page.route("/api/v1/events", r => r.fulfill({ json: EVENTS }));
  });

  test("shows BI tab with org health score and domain count", async ({ page }) => {
    await page.goto("/bi");
    await expect(page.getByRole("heading", { name: "BI & Observability" })).toBeVisible();
    await expect(page.getByText("Org health score")).toBeVisible();
    await expect(page.getByText("74")).toBeVisible();
    await expect(page.getByText("Domains tracked")).toBeVisible();
    await expect(page.getByText("3")).toBeVisible();
  });

  test("shows org health trend arrow", async ({ page }) => {
    await page.goto("/bi");
    await expect(page.getByText("↑")).toBeVisible();
  });

  test("shows domain scores", async ({ page }) => {
    await page.goto("/bi");
    await expect(page.getByText("Ops")).toBeVisible();
    await expect(page.getByText("82")).toBeVisible();
  });

  test("observability tab shows execution run count", async ({ page }) => {
    await page.goto("/bi");
    await page.getByRole("button", { name: "Observability" }).click();
    await expect(page.getByText("Total runs")).toBeVisible();
    await expect(page.getByText("Last daily cadence")).toBeVisible();
  });

  test("observability tab shows recent runs", async ({ page }) => {
    await page.goto("/bi");
    await page.getByRole("button", { name: "Observability" }).click();
    await expect(page.getByText(/5 actions/)).toBeVisible();
    await expect(page.getByText("completed")).toBeVisible();
  });

  test("events tab shows org events", async ({ page }) => {
    await page.goto("/bi");
    await page.getByRole("button", { name: /Events/ }).click();
    await expect(page.getByText("New user signed up via referral")).toBeVisible();
    await expect(page.getByText("growth", { exact: true })).toBeVisible();
  });

  test("empty events state", async ({ page }) => {
    await page.route("/api/v1/events", r => r.fulfill({ json: { events: [] } }));
    await page.goto("/bi");
    await page.getByRole("button", { name: /Events/ }).click();
    await expect(page.getByText("No events recorded.")).toBeVisible();
  });
});
