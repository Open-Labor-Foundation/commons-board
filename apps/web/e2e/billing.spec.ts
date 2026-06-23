import { test, expect } from "@playwright/test";
import { mockCommon } from "./helpers";

const METRICS = { totalRevenue: 60000, mrr: 5000, arr: 60000, activeCustomers: 40, trialCustomers: 8, churnedCustomers: 2, eventCounts: { payment_received: 15, subscription_started: 5 }, currency: "USD" };
const EVENTS = { events: [{ id: "ev-1", eventName: "payment_received", customerId: "cust-1", amount: 499, currency: "USD", createdAt: new Date().toISOString() }] };
const CUSTOMERS = { customers: [{ id: "cust-1", name: "Acme Corp", email: "billing@acme.com", mrr: 499, status: "active", startedAt: new Date().toISOString(), currency: "USD" }] };

test.describe("Billing page", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommon(page);
    await page.route("/api/v1/billing/metrics", r => r.fulfill({ json: METRICS }));
    await page.route("/api/v1/billing/events", r => r.fulfill({ json: EVENTS }));
    await page.route("/api/v1/billing/customers", r => r.fulfill({ json: CUSTOMERS }));
  });

  test("shows Billing heading and MRR/ARR stats", async ({ page }) => {
    await page.goto("/billing");
    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
    await expect(page.getByText("$5,000")).toBeVisible();
    // ARR and Total Revenue both equal $60,000; use first() to avoid strict mode
    await expect(page.getByText("$60,000").first()).toBeVisible();
    await expect(page.getByText("40")).toBeVisible();
    await expect(page.getByText("8")).toBeVisible();
  });

  test("shows event count chips from metrics", async ({ page }) => {
    await page.goto("/billing");
    await expect(page.getByText("payment received").first()).toBeVisible();
    await expect(page.getByText("15")).toBeVisible();
  });

  test("events tab shows billing event", async ({ page }) => {
    await page.goto("/billing");
    await expect(page.getByText(/Events \(1\)/)).toBeVisible();
    // "payment received" appears in chips AND event rows; first() is safe
    await expect(page.getByText("payment received").first()).toBeVisible();
    await expect(page.getByText("$499")).toBeVisible();
    await expect(page.getByText("cust-1")).toBeVisible();
  });

  test("Add event sends POST with correct payload", async ({ page }) => {
    let body: Record<string, unknown> | null = null;
    await page.route("/api/v1/billing/events", async r => {
      if (r.request().method() === "POST") { body = JSON.parse(r.request().postData() ?? "{}"); await r.fulfill({ json: { id: "ev-2" } }); }
      else await r.fulfill({ json: EVENTS });
    });
    await page.goto("/billing");
    await page.getByPlaceholder("Optional").fill("cust-99");
    await page.locator("input[type=number]").first().fill("299");
    await page.getByRole("button", { name: "Add event" }).click();
    expect(body!.customerId).toBe("cust-99");
    expect(body!.amount).toBe(299);
    expect(body!.eventName).toBeDefined();
  });

  test("customers tab shows customer", async ({ page }) => {
    await page.goto("/billing");
    await page.getByRole("button", { name: /Customers/ }).click();
    await expect(page.getByText("Acme Corp")).toBeVisible();
    await expect(page.getByText("billing@acme.com")).toBeVisible();
    await expect(page.getByText("$499/mo")).toBeVisible();
    await expect(page.getByText("active", { exact: true })).toBeVisible();
  });

  test("Add customer sends POST", async ({ page }) => {
    let body: Record<string, unknown> | null = null;
    await page.route("/api/v1/billing/customers", async r => {
      if (r.request().method() === "POST") { body = JSON.parse(r.request().postData() ?? "{}"); await r.fulfill({ json: { id: "cust-2" } }); }
      else await r.fulfill({ json: CUSTOMERS });
    });
    await page.goto("/billing");
    await page.getByRole("button", { name: /Customers/ }).click();
    await page.getByPlaceholder("Customer name").fill("Beta LLC");
    await page.getByPlaceholder("email@example.com").fill("beta@beta.com");
    await page.getByRole("button", { name: "Add" }).click();
    expect(body!.name).toBe("Beta LLC");
    expect(body!.email).toBe("beta@beta.com");
  });
});
