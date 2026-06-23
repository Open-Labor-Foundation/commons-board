import { test, expect } from "@playwright/test";
import { SETTINGS } from "./helpers";

// Setup page has no nav-shell — no common mock needed.

test.describe("Setup flow", () => {
  test("root redirects to /setup when org_name is not configured", async ({ page }) => {
    await page.route("/api/v1/settings", r => r.fulfill({ json: { ...SETTINGS, org_name: undefined } }));
    await page.goto("/");
    await expect(page).toHaveURL(/\/setup/);
  });

  test("root redirects to /dashboard when org_name is configured", async ({ page }) => {
    await page.route("/api/v1/settings", r => r.fulfill({ json: SETTINGS }));
    await page.route("/api/v1/approvals**", r => r.fulfill({ json: { approvals: [] } }));
    await page.route("/api/v1/level4/actions**", r => r.fulfill({ json: { actions: [] } }));
    await page.route("/api/v1/decision-log**", r => r.fulfill({ json: { entries: [] } }));
    await page.route("/api/v1/treasury/balance", r => r.fulfill({ json: { totalIncome: 0, availableForDistribution: 0, currency: "USD" } }));
    await page.route("/api/v1/billing/metrics", r => r.fulfill({ json: { mrr: 0, arr: 0, activeCustomers: 0, currency: "USD" } }));
    await page.route("/api/v1/level4/dashboard", r => r.fulfill({ json: { metrics: { actions: { total: 0, pending: 0 }, outreach: { prospects: 0 } } } }));
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("setup page shows workspace name step by default", async ({ page }) => {
    await page.goto("/setup");
    await expect(page.getByText("Set up your workspace")).toBeVisible();
    await expect(page.getByPlaceholder("e.g. Acme Workers Cooperative")).toBeVisible();
    await expect(page.getByText("Governance mode")).toBeVisible();
  });

  test("Next button is disabled until workspace name is entered", async ({ page }) => {
    await page.goto("/setup");
    await expect(page.getByRole("button", { name: "Next →" })).toBeDisabled();
    await page.getByPlaceholder("e.g. Acme Workers Cooperative").fill("My Coop");
    await expect(page.getByRole("button", { name: "Next →" })).toBeEnabled();
  });

  test("advancing to provider step shows provider options", async ({ page }) => {
    await page.goto("/setup");
    await page.getByPlaceholder("e.g. Acme Workers Cooperative").fill("My Coop");
    await page.getByRole("button", { name: "Next →" }).click();
    await expect(page.getByText("Featherless AI")).toBeVisible();
    await expect(page.getByText("OpenAI")).toBeVisible();
    await expect(page.getByText("Anthropic")).toBeVisible();
    await expect(page.getByPlaceholder("e.g. Qwen/Qwen3-32B")).toBeVisible();
    await expect(page.getByPlaceholder("e.g. FEATHERLESS_API_KEY")).toBeVisible();
  });

  test("Back button returns to workspace step", async ({ page }) => {
    await page.goto("/setup");
    await page.getByPlaceholder("e.g. Acme Workers Cooperative").fill("My Coop");
    await page.getByRole("button", { name: "Next →" }).click();
    await page.getByRole("button", { name: "← Back" }).click();
    await expect(page.getByPlaceholder("e.g. Acme Workers Cooperative")).toBeVisible();
    await expect(page.getByPlaceholder("e.g. Acme Workers Cooperative")).toHaveValue("My Coop");
  });

  test("selecting a provider auto-fills model and key env defaults", async ({ page }) => {
    await page.goto("/setup");
    await page.getByPlaceholder("e.g. Acme Workers Cooperative").fill("My Coop");
    await page.getByRole("button", { name: "Next →" }).click();
    await page.getByLabel("OpenAI").click();
    await expect(page.getByPlaceholder("e.g. Qwen/Qwen3-32B")).toHaveValue("gpt-4o");
    await expect(page.getByPlaceholder("e.g. FEATHERLESS_API_KEY")).toHaveValue("OPENAI_API_KEY");
  });

  test("Finish setup sends correct API payload with snake_case fields", async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null;
    await page.route("/api/v1/settings", async r => {
      if (r.request().method() === "PUT") {
        capturedBody = JSON.parse(r.request().postData() ?? "{}");
        await r.fulfill({ json: { ...SETTINGS, org_name: "My Coop" } });
      } else {
        await r.continue();
      }
    });
    await page.route("/api/v1/approvals**", r => r.fulfill({ json: { approvals: [] } }));
    await page.route("/api/v1/level4/actions**", r => r.fulfill({ json: { actions: [] } }));
    await page.route("/api/v1/decision-log**", r => r.fulfill({ json: { entries: [] } }));
    await page.route("/api/v1/treasury/balance", r => r.fulfill({ json: { totalIncome: 0, availableForDistribution: 0, currency: "USD" } }));
    await page.route("/api/v1/billing/metrics", r => r.fulfill({ json: { mrr: 0, arr: 0, activeCustomers: 0, currency: "USD" } }));
    await page.route("/api/v1/level4/dashboard", r => r.fulfill({ json: { metrics: { actions: { total: 0, pending: 0 }, outreach: { prospects: 0 } } } }));

    await page.goto("/setup");
    await page.getByPlaceholder("e.g. Acme Workers Cooperative").fill("My Coop");
    await page.getByRole("button", { name: "Next →" }).click();
    await page.getByRole("button", { name: "Finish setup" }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.org_name).toBe("My Coop");
    expect(capturedBody!.governance_mode).toBe("collective");
    expect(capturedBody!.active_provider_id).toBe("featherless");
    expect(Array.isArray(capturedBody!.providers)).toBe(true);
    const providers = capturedBody!.providers as Array<Record<string, unknown>>;
    expect(providers[0].api_key_env).toBe("FEATHERLESS_API_KEY");
    expect(providers[0].model).toBe("Qwen/Qwen3-32B");
  });

  test("Finish setup shows error when API fails", async ({ page }) => {
    await page.route("/api/v1/settings", async r => {
      if (r.request().method() === "PUT") await r.fulfill({ status: 500, json: { error: "server error" } });
      else await r.continue();
    });
    await page.goto("/setup");
    await page.getByPlaceholder("e.g. Acme Workers Cooperative").fill("My Coop");
    await page.getByRole("button", { name: "Next →" }).click();
    await page.getByRole("button", { name: "Finish setup" }).click();
    await expect(page.getByText(/Failed to save settings/)).toBeVisible();
  });
});
