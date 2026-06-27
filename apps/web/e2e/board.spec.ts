import { test, expect } from "@playwright/test";
import { mockCommon } from "./helpers";

const REQUESTS = {
  requests: [
    { id: "req-1", title: "Expand ops tooling", request: "We need to add a new CI pipeline to reduce build times.", requested_by: "admin", target_domain: "ops", status: "submitted", priority: "high", risk_level: "low", approval_required: false, constraints: [], success_criteria: [], dependency_ids: [], routing_mode: "auto", target_chair_id: "ops-1", created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: "req-2", title: "Finance audit", request: "Q3 finance audit required before close.", requested_by: "admin", target_domain: "finance", status: "planned", priority: "medium", risk_level: "medium", approval_required: true, constraints: [], success_criteria: [], dependency_ids: [], routing_mode: "auto", target_chair_id: "finance-1", created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ],
  total: 2,
};

const BRIEF = {
  generated_at: new Date().toISOString(),
  daily: { headline: "Strong pipeline momentum this week.", text: "The ops team resolved 3 blockers.", next_best_action: "Schedule stakeholder demo." },
  weekly: { tldr: "Week 3 summary: growth on track.", objective_status: { trend: "up" }, decisions_needed: ["Approve Q4 budget", "Select CRM vendor"] },
};

test.describe("Board page", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommon(page);
    await page.route("/api/v1/board/requests", r => r.fulfill({ json: REQUESTS }));
    await page.route("/api/v1/cadence/brief", r => r.fulfill({ json: BRIEF }));
  });

  test("shows open request count and total", async ({ page }) => {
    await page.goto("/board");
    await expect(page.getByRole("heading", { name: "Board" })).toBeVisible();
    await expect(page.getByText("Open requests")).toBeVisible();
    await expect(page.getByText("Total requests")).toBeVisible();
  });

  test("shows board requests with count", async ({ page }) => {
    await page.goto("/board");
    await expect(page.getByText(/Board Requests \(2\)/)).toBeVisible();
    await expect(page.getByText("Expand ops tooling")).toBeVisible();
  });

  test("expanding a request shows content", async ({ page }) => {
    await page.goto("/board");
    await page.getByText("Expand ops tooling").click();
    await expect(page.getByText("We need to add a new CI pipeline to reduce build times.")).toBeVisible();
  });

  test("collapsing hides content", async ({ page }) => {
    await page.goto("/board");
    await page.getByText("Expand ops tooling").click();
    await expect(page.getByText("We need to add a new CI pipeline to reduce build times.")).toBeVisible();
    await page.getByText("Expand ops tooling").click();
    await expect(page.getByText("We need to add a new CI pipeline to reduce build times.")).not.toBeVisible();
  });

  test("empty requests state shows message", async ({ page }) => {
    await page.route("/api/v1/board/requests", r => r.fulfill({ json: { requests: [], total: 0 } }));
    await page.goto("/board");
    await expect(page.getByText("No board requests yet.")).toBeVisible();
  });

  test("Latest Brief tab shows cadence brief headline", async ({ page }) => {
    await page.goto("/board");
    await page.getByRole("button", { name: "Latest Brief" }).click();
    await expect(page.getByText("Strong pipeline momentum this week.")).toBeVisible();
    await expect(page.getByText("Schedule stakeholder demo.")).toBeVisible();
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
