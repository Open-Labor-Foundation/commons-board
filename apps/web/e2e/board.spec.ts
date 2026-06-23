import { test, expect } from "@playwright/test";
import { mockCommon } from "./helpers";

const BOARD = {
  board_status: "active",
  active_domains: ["ops", "finance", "growth"],
  next_cadence: new Date(Date.now() + 3600_000).toISOString(),
  briefs: [
    { brief_id: "b-1", brief_type: "executive", domain: "ops", title: "Weekly Ops Brief", content: "Operations are running smoothly this week.", generated_at: new Date().toISOString() },
    { brief_id: "b-2", brief_type: "financial", domain: "finance", title: null, content: "Cash flow is positive.", generated_at: new Date().toISOString() },
  ],
};

test.describe("Board page", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommon(page);
    await page.route("/api/v1/board", r => r.fulfill({ json: BOARD }));
  });

  test("shows board status and active domains", async ({ page }) => {
    await page.goto("/board");
    await expect(page.getByRole("heading", { name: "Board" })).toBeVisible();
    // board_status "active" appears in the stat card
    await expect(page.getByText("active").first()).toBeVisible();
    await expect(page.getByText("ops, finance, growth")).toBeVisible();
  });

  test("shows board briefs with count", async ({ page }) => {
    await page.goto("/board");
    await expect(page.getByText(/Board Briefs \(2\)/)).toBeVisible();
    await expect(page.getByText("Weekly Ops Brief")).toBeVisible();
  });

  test("falls back to humanized brief_type for untitled brief", async ({ page }) => {
    await page.goto("/board");
    // "Financial" appears as both the title fallback and the type badge — use first()
    await expect(page.getByText("Financial").first()).toBeVisible();
  });

  test("expanding a brief shows content", async ({ page }) => {
    await page.goto("/board");
    await page.getByText("Weekly Ops Brief").click();
    await expect(page.getByText("Operations are running smoothly this week.")).toBeVisible();
  });

  test("collapsing hides content", async ({ page }) => {
    await page.goto("/board");
    await page.getByText("Weekly Ops Brief").click();
    await expect(page.getByText("Operations are running smoothly this week.")).toBeVisible();
    await page.getByText("Weekly Ops Brief").click();
    await expect(page.getByText("Operations are running smoothly this week.")).not.toBeVisible();
  });

  test("empty briefs state shows message", async ({ page }) => {
    await page.route("/api/v1/board", r => r.fulfill({ json: { ...BOARD, briefs: [] } }));
    await page.goto("/board");
    await expect(page.getByText("No board briefs generated yet.")).toBeVisible();
  });

  test("Simulation tab shows scenario input and Simulate button", async ({ page }) => {
    await page.goto("/board");
    await page.getByRole("button", { name: "Simulation" }).click();
    await expect(page.getByPlaceholder(/Describe the scenario/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Simulate" })).toBeDisabled();
  });

  test("simulation sends POST and shows result", async ({ page }) => {
    const SIM = { scenario: "Expand into EU", outcome: "Moderate growth expected.", projected_metrics: { revenue_increase: "18%" }, recommendations: ["Hire locally"], run_at: new Date().toISOString() };
    let called = false;
    await page.route("/api/v1/sim", async r => { called = true; await r.fulfill({ json: SIM }); });
    await page.goto("/board");
    await page.getByRole("button", { name: "Simulation" }).click();
    await page.getByPlaceholder(/Describe the scenario/).fill("Expand into EU");
    await page.getByRole("button", { name: "Simulate" }).click();
    expect(called).toBe(true);
    await expect(page.getByText("Moderate growth expected.")).toBeVisible();
    await expect(page.getByText("Hire locally")).toBeVisible();
  });
});
