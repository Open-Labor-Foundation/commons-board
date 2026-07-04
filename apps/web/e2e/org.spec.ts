import { test, expect } from "@playwright/test";
import { mockCommon } from "./helpers";

const MATCHES = { matches: [
  { id: "m-1", org_role: "Operations Manager", description: "Oversees daily ops", matched_specialist: "ops-specialist-v2", match_score: 0.91, status: "matched", confirmed_at: null },
  { id: "m-2", org_role: "Finance Lead", description: "Manages budgets", matched_specialist: null, match_score: null, status: "unmatched" },
] };
const GAPS = { gaps: [{ gap_id: "g-1", description: "No legal counsel specialist found", priority: "high", submitted_at: new Date().toISOString(), status: "open" }] };
const CATALOG = { last_sync: new Date().toISOString(), agent_count: 651, status: "synced" };

test.describe("Org & Specialists page", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommon(page);
    await page.route("/api/v1/org/specialist-matches", r => r.fulfill({ json: MATCHES }));
    await page.route("/api/v1/org/gaps", r => r.fulfill({ json: GAPS }));
    await page.route("/api/v1/org/catalog-sync", r => r.fulfill({ json: CATALOG }));
  });

  test("shows heading, catalog count, and Re-resolve button", async ({ page }) => {
    await page.goto("/org");
    await expect(page.getByText("Org & Specialists")).toBeVisible();
    await expect(page.getByText("651 agents")).toBeVisible();
    await expect(page.getByRole("button", { name: "Re-resolve specialists" })).toBeVisible();
  });

  test("shows specialist matches with role, specialist name, score, and status", async ({ page }) => {
    await page.goto("/org");
    await expect(page.getByText("Operations Manager")).toBeVisible();
    await expect(page.getByText("ops-specialist-v2")).toBeVisible();
    await expect(page.getByText("91%")).toBeVisible();
    await expect(page.getByText("matched").first()).toBeVisible();
  });

  test("unmatched role shows dash for specialist and score", async ({ page }) => {
    await page.goto("/org");
    await expect(page.getByText("Finance Lead")).toBeVisible();
    // matched_specialist is null — shows "—" twice
    const dashes = page.getByText("—");
    await expect(dashes).not.toHaveCount(0);
  });

  test("Confirm all button appears when a matched but unconfirmed specialist exists", async ({ page }) => {
    await page.goto("/org");
    await expect(page.getByRole("button", { name: "Confirm all" })).toBeVisible();
  });

  test("Confirm all sends POST to /confirm-specialists", async ({ page }) => {
    let body: Record<string, unknown> | null = null;
    await page.route("/api/v1/org/confirm-specialists", async r => { body = JSON.parse(r.request().postData() ?? "{}"); await r.fulfill({ json: { ok: true } }); });
    await page.goto("/org");
    await page.getByRole("button", { name: "Confirm all" }).click();
    expect(body!.confirmations).toBeDefined();
  });

  test("Re-resolve sends POST and shows confirmation message", async ({ page }) => {
    let called = false;
    await page.route("/api/v1/org/resolve-specialists", async r => { called = true; await r.fulfill({ json: { resolved: 2 } }); });
    await page.goto("/org");
    await page.getByRole("button", { name: "Re-resolve specialists" }).click();
    expect(called).toBe(true);
    await expect(page.getByText("Resolution complete.")).toBeVisible();
  });

  test("shows coverage gap with high priority badge", async ({ page }) => {
    await page.goto("/org");
    await expect(page.getByText("No legal counsel specialist found")).toBeVisible();
    await expect(page.getByText("high").first()).toBeVisible();
  });

  test("Submit gap sends POST with description and priority", async ({ page }) => {
    let body: Record<string, unknown> | null = null;
    await page.route("/api/v1/org/gaps", async r => {
      if (r.request().method() === "POST") { body = JSON.parse(r.request().postData() ?? "{}"); await r.fulfill({ json: { gap_id: "g-2" } }); }
      else await r.fulfill({ json: GAPS });
    });
    await page.goto("/org");
    await page.getByPlaceholder("Describe the missing role or capability…").fill("Need an HR generalist");
    await page.getByRole("button", { name: "Submit gap" }).click();
    expect(body!.description).toBe("Need an HR generalist");
    expect(body!.priority).toBe("medium");
  });

  test("empty matches state shows descriptive guidance", async ({ page }) => {
    await page.route("/api/v1/org/specialist-matches", r => r.fulfill({ json: { matches: [] } }));
    await page.goto("/org");
    await expect(page.getByText("No specialist matches yet.")).toBeVisible();
    await expect(page.getByText(/Use the interview flow/)).toBeVisible();
  });
});
