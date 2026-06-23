import { test, expect } from "@playwright/test";
import { mockCommon } from "./helpers";

const DASHBOARD = { status: "active", provisioning_complete: true, actions_pending: 2, outreach_active: true, crm_pipeline_count: 5 };
const ACTIONS = { actions: [{ action_id: "a-1", title: "Follow up with Acme", action_type: "follow_up", status: "pending", created_at: new Date().toISOString() }] };
const OUTREACH = { enabled: true, message_template: "Hello {name}, …", auto_followup: false, delay_days: 3 };
const PIPELINE = { pipeline: [{ id: "p-1", name: "Acme Corp", stage: "qualified", value: 12000, contact: "jane@acme.com", last_activity: new Date().toISOString() }] };

test.describe("Level 4 Autonomous Outreach page", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommon(page);
    await page.route("/api/v1/level4/dashboard", r => r.fulfill({ json: DASHBOARD }));
    await page.route("/api/v1/level4/actions", r => r.fulfill({ json: ACTIONS }));
    await page.route("/api/v1/level4/outreach/config", r => r.fulfill({ json: OUTREACH }));
    await page.route("/api/v1/level4/crm/pipeline", r => r.fulfill({ json: PIPELINE }));
    // mock the pending filter used by nav-shell's badge call
    await page.route("/api/v1/level4/actions?status=pending&limit=50", r => r.fulfill({ json: { actions: [] } }));
  });

  test("shows heading and dashboard stats", async ({ page }) => {
    await page.goto("/level4");
    await expect(page.getByRole("heading", { name: /Level 4/ })).toBeVisible();
    await expect(page.getByText("active").first()).toBeVisible();
    await expect(page.getByText("complete")).toBeVisible();
    await expect(page.getByText(/2/)).toBeVisible();
  });

  test("actions tab shows existing action", async ({ page }) => {
    await page.goto("/level4");
    await expect(page.getByText("Follow up with Acme")).toBeVisible();
    await expect(page.locator("span", { hasText: /^Follow Up$/ })).toBeVisible();
    await expect(page.getByText("pending", { exact: true })).toBeVisible();
  });

  test("Add button disabled until title entered", async ({ page }) => {
    await page.goto("/level4");
    await expect(page.getByRole("button", { name: "Add" })).toBeDisabled();
    await page.getByPlaceholder("Action title").fill("New action");
    await expect(page.getByRole("button", { name: "Add" })).toBeEnabled();
  });

  test("creating action sends POST with correct payload", async ({ page }) => {
    let body: Record<string, unknown> | null = null;
    await page.route("/api/v1/level4/actions", async r => {
      if (r.request().method() === "POST") { body = JSON.parse(r.request().postData() ?? "{}"); await r.fulfill({ json: { action_id: "a-2", status: "pending" } }); }
      else await r.fulfill({ json: ACTIONS });
    });
    await page.goto("/level4");
    await page.getByPlaceholder("Action title").fill("Send proposal");
    await page.getByRole("button", { name: "Add" }).click();
    expect(body!.title).toBe("Send proposal");
  });

  test("outreach tab shows config with checkbox and template", async ({ page }) => {
    await page.goto("/level4");
    await page.getByRole("button", { name: "Outreach Config" }).click();
    await expect(page.getByText("Outreach configuration")).toBeVisible();
    const checkbox = page.getByLabel("Outreach enabled");
    await expect(checkbox).toBeChecked();
    await expect(page.getByPlaceholder("Template for outreach messages…")).toHaveValue("Hello {name}, …");
  });

  test("Save config sends PUT to /outreach/config", async ({ page }) => {
    let called = false;
    await page.route("/api/v1/level4/outreach/config", async r => {
      if (r.request().method() === "PUT") { called = true; await r.fulfill({ json: { ok: true } }); }
      else await r.fulfill({ json: OUTREACH });
    });
    await page.goto("/level4");
    await page.getByRole("button", { name: "Outreach Config" }).click();
    await page.getByRole("button", { name: "Save config" }).click();
    expect(called).toBe(true);
  });

  test("CRM tab shows pipeline entry grouped by stage", async ({ page }) => {
    await page.goto("/level4");
    await page.getByRole("button", { name: /CRM Pipeline/ }).click();
    await expect(page.getByText("Acme Corp")).toBeVisible();
    await expect(page.getByText("$12,000")).toBeVisible();
    await expect(page.getByText("jane@acme.com")).toBeVisible();
    await expect(page.locator("p", { hasText: "Qualified" }).first()).toBeVisible();
  });

  test("adding CRM entry sends POST", async ({ page }) => {
    let body: Record<string, unknown> | null = null;
    await page.route("/api/v1/level4/crm/pipeline", async r => {
      if (r.request().method() === "POST") { body = JSON.parse(r.request().postData() ?? "{}"); await r.fulfill({ json: { id: "p-2" } }); }
      else await r.fulfill({ json: PIPELINE });
    });
    await page.goto("/level4");
    await page.getByRole("button", { name: /CRM Pipeline/ }).click();
    await page.getByPlaceholder("Lead or company name").fill("Beta Inc");
    await page.getByRole("button", { name: "Add" }).click();
    expect(body!.name).toBe("Beta Inc");
  });
});
