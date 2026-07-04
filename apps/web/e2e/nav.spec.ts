import { test, expect } from "@playwright/test";
import { mockCommon, SETTINGS } from "./helpers";

const NAV_HREFS = [
  "/dashboard", "/board", "/artifacts", "/onboarding", "/launch", "/org",
  "/approvals", "/votes", "/governance", "/cadence", "/execution",
  "/autonomous", "/bi", "/level4", "/treasury", "/billing", "/federation", "/settings",
];

test.describe("Navigation shell", () => {
  test.beforeEach(async ({ page }) => {
    // Wildcard catch-all registered FIRST so later (more specific) routes win
    await page.route("/api/v1/**", r => r.fulfill({ json: {} }));
    await mockCommon(page);
  });

  test("shows commons-board brand and org name in header", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("commons-board")).toBeVisible();
    await expect(page.getByText("Test Workspace")).toBeVisible();
  });

  test("all 18 nav items are visible", async ({ page }) => {
    await page.goto("/dashboard");
    for (const href of NAV_HREFS) {
      await expect(page.locator(`nav a[href="${href}"]`)).toBeVisible();
    }
  });

  test("active link is highlighted on Dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator('nav a[href="/dashboard"]')).toHaveCSS("font-weight", "600");
  });

  test("active link changes when navigating to Settings", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator('nav a[href="/settings"]')).toHaveCSS("font-weight", "600");
    await expect(page.locator('nav a[href="/dashboard"]')).not.toHaveCSS("font-weight", "600");
  });

  test("approvals badge appears when there are pending approvals", async ({ page }) => {
    // Override the 0-approval stub from mockCommon with a 3-approval response
    await page.route("/api/v1/approvals?status=pending&limit=50", r =>
      r.fulfill({ json: { approvals: [{ id: "1" }, { id: "2" }, { id: "3" }] } })
    );
    await page.goto("/dashboard");
    await expect(page.locator('nav a[href="/approvals"] span').last()).toHaveText("3");
  });

  test("header urgent badge links to dashboard when pending > 0", async ({ page }) => {
    await page.route("/api/v1/approvals?status=pending&limit=50", r =>
      r.fulfill({ json: { approvals: [{ id: "1" }] } })
    );
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: /1 pending/ })).toBeVisible();
  });

  test("nav is hidden on /setup route", async ({ page }) => {
    await page.goto("/setup");
    await expect(page.locator('nav a[href="/dashboard"]')).not.toBeVisible();
  });

  test("clicking Board nav link goes to /board", async ({ page }) => {
    await page.route("/api/v1/board", r => r.fulfill({ json: { briefs: [], board_status: "active", active_domains: [] } }));
    await page.goto("/dashboard");
    await page.locator('nav a[href="/board"]').click();
    await expect(page).toHaveURL(/\/board/);
    await expect(page.getByRole("heading", { name: "Board" })).toBeVisible();
  });

  test("clicking Settings nav link goes to /settings", async ({ page }) => {
    await page.goto("/dashboard");
    await page.locator('nav a[href="/settings"]').click();
    await expect(page).toHaveURL(/\/settings/);
  });
});
