import { test, expect } from "@playwright/test";
import { mockCommon } from "./helpers";

const BI = { mrr: 5000, customers: 42, churn_rate: 2.5, metrics: [{ name: "conversion_rate", value: 8.3, unit: "%", trend: "up" }] };
// uptime: 99.9 so toFixed(1) shows "99.9%" without rounding to 100.0%
const OBS = { api_latency_p50: 45, api_latency_p99: 210, error_rate: 0.1, uptime: 99.9, active_agents: 3, health: { database: "healthy", api: "healthy", cache: "degraded" } };
const EVENTS = { events: [{ event_id: "ev-1", type: "user_signup", domain: "growth", summary: "New user signed up via referral", actor: "growth-agent", created_at: new Date().toISOString() }] };

test.describe("BI & Observability page", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommon(page);
    await page.route("/api/v1/bi", r => r.fulfill({ json: BI }));
    await page.route("/api/v1/obs", r => r.fulfill({ json: OBS }));
    await page.route("/api/v1/events", r => r.fulfill({ json: EVENTS }));
  });

  test("shows BI tab with MRR and ARR computed", async ({ page }) => {
    await page.goto("/bi");
    await expect(page.getByRole("heading", { name: "BI & Observability" })).toBeVisible();
    await expect(page.getByText("MRR")).toBeVisible();
    await expect(page.getByText("$5,000")).toBeVisible();
    await expect(page.getByText("$60,000")).toBeVisible();
    await expect(page.getByText("42")).toBeVisible();
  });

  test("shows churn rate with trend arrow", async ({ page }) => {
    await page.goto("/bi");
    await expect(page.getByText("2.5%")).toBeVisible();
    await expect(page.getByText("↓")).toBeVisible();
  });

  test("shows extra metrics", async ({ page }) => {
    await page.goto("/bi");
    await expect(page.getByText("Conversion Rate")).toBeVisible();
    await expect(page.getByText("8.3%")).toBeVisible();
    await expect(page.getByText("↑")).toBeVisible();
  });

  test("observability tab shows latency and error rate", async ({ page }) => {
    await page.goto("/bi");
    await page.getByRole("button", { name: "Observability" }).click();
    await expect(page.getByText("P50 latency")).toBeVisible();
    await expect(page.getByText("45ms")).toBeVisible();
    await expect(page.getByText("210ms")).toBeVisible();
    await expect(page.getByText("0.1%")).toBeVisible();
    await expect(page.getByText("99.9%")).toBeVisible();
  });

  test("observability tab shows component health", async ({ page }) => {
    await page.goto("/bi");
    await page.getByRole("button", { name: "Observability" }).click();
    await expect(page.getByText("Database")).toBeVisible();
    await expect(page.getByText("healthy").first()).toBeVisible();
    await expect(page.getByText("degraded")).toBeVisible();
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
