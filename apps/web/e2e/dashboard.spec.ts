import { test, expect } from "@playwright/test";
import { mockCommon, SETTINGS } from "./helpers";

const DASH_ROUTES = async (page: import("@playwright/test").Page) => {
  await page.route("/api/v1/approvals?status=pending&limit=20", r => r.fulfill({
    json: { approvals: [{ approval_id: "appr-1", action_id: "act-1", status: "pending", created_at: new Date().toISOString() }] }
  }));
  await page.route("/api/v1/level4/actions?status=pending&limit=20", r => r.fulfill({ json: { actions: [] } }));
  await page.route("/api/v1/decision-log?limit=12", r => r.fulfill({ json: { entries: [{ event: { event_id: "ev-1", event_type: "setting_updated", actor: "admin", at: new Date().toISOString() } }] } }));
  await page.route("/api/v1/treasury/balance", r => r.fulfill({ json: { totalIncome: 10000, availableForDistribution: 5000, currency: "USD" } }));
  await page.route("/api/v1/billing/metrics", r => r.fulfill({ json: { mrr: 1500, arr: 18000, activeCustomers: 12, currency: "USD" } }));
  await page.route("/api/v1/level4/dashboard", r => r.fulfill({ json: { metrics: { actions: { total: 5, pending: 1 }, outreach: { prospects: 3 } } } }));
};

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommon(page);
    await DASH_ROUTES(page);
  });

  test("renders metrics strip with MRR and treasury", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("MRR")).toBeVisible();
    await expect(page.getByText("$1,500")).toBeVisible();
    await expect(page.getByText("Treasury").first()).toBeVisible();
  });

  test("shows pending approvals in sidebar", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("Approvals (1)")).toBeVisible();
    await expect(page.getByText(/act-1/)).toBeVisible();
  });

  test("shows recent decisions in sidebar", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("Recent decisions")).toBeVisible();
    await expect(page.getByText("Setting Updated")).toBeVisible();
  });

  test("chat input is visible and empty by default", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByPlaceholder("Message the board…")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  test("Send button enables once text is entered", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByPlaceholder("Message the board…").fill("What is the status?");
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  test("chat sends POST with message and displays board reply", async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null;
    await page.route("/api/v1/board/chat", async r => {
      capturedBody = JSON.parse(r.request().postData() ?? "{}");
      await r.fulfill({ json: { thread_id: "thr-1", headline: "Ops Chair", summary_markdown: "The board has reviewed your question.", meta: { domain: "ops", chair_id: "ops" } } });
    });
    await page.goto("/dashboard");
    await page.getByPlaceholder("Message the board…").fill("What is our runway?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("The board has reviewed your question.")).toBeVisible();
    expect(capturedBody!.message).toBe("What is our runway?");
  });

  test("chat shows error message when board is unreachable", async ({ page }) => {
    await page.route("/api/v1/board/chat", r => r.fulfill({ status: 503, json: { error: "service unavailable" } }));
    await page.goto("/dashboard");
    await page.getByPlaceholder("Message the board…").fill("Hello?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Unable to reach the board")).toBeVisible();
  });

  test("thread ID appears after first chat reply", async ({ page }) => {
    await page.route("/api/v1/board/chat", r => r.fulfill({ json: { thread_id: "thr-abc123", headline: "Board", summary_markdown: "Acknowledged.", meta: { domain: null, chair_id: null } } }));
    await page.goto("/dashboard");
    await page.getByPlaceholder("Message the board…").fill("Hello");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Thread thr-abc1")).toBeVisible();
    await expect(page.getByRole("button", { name: "New thread" })).toBeVisible();
  });

  test("New thread button clears messages", async ({ page }) => {
    await page.route("/api/v1/board/chat", r => r.fulfill({ json: { thread_id: "thr-1", headline: "Board", summary_markdown: "Reply here.", meta: { domain: null, chair_id: null } } }));
    await page.goto("/dashboard");
    await page.getByPlaceholder("Message the board…").fill("Hello");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Reply here.")).toBeVisible();
    await page.getByRole("button", { name: "New thread" }).click();
    await expect(page.getByText("Reply here.")).not.toBeVisible();
    await expect(page.getByText("Ask the board anything")).toBeVisible();
  });

  test("org name from settings appears in header", async ({ page }) => {
    await page.route("/api/v1/settings", r => r.fulfill({ json: { ...SETTINGS, org_name: "Acme Coop" } }));
    await page.goto("/dashboard");
    await expect(page.getByText("Acme Coop")).toBeVisible();
  });
});
