import { test, expect } from "@playwright/test";
import { mockCommon, SETTINGS } from "./helpers";

test.describe("Settings page", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommon(page);
  });

  test("loads and displays current settings", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Workspace").first()).toBeVisible();
    await expect(page.getByText("AI Provider").first()).toBeVisible();
    await expect(page.getByPlaceholder("e.g. Acme Workers Cooperative")).toHaveValue("Test Workspace");
  });

  test("governance mode radio reflects saved setting", async ({ page }) => {
    await page.goto("/settings");
    const collectiveRadio = page.getByRole("radio", { name: "Collective" });
    await expect(collectiveRadio).toBeChecked();
  });

  test("active provider radio reflects saved setting", async ({ page }) => {
    await page.goto("/settings");
    const featherlessRadio = page.getByRole("radio", { name: "Featherless AI" });
    await expect(featherlessRadio).toBeChecked();
  });

  test("saves settings with correct API payload", async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null;
    await page.route("/api/v1/settings", async r => {
      if (r.request().method() === "PUT") {
        capturedBody = JSON.parse(r.request().postData() ?? "{}");
        await r.fulfill({ json: { ...SETTINGS, org_name: "New Name" } });
      } else {
        await r.fulfill({ json: SETTINGS });
      }
    });
    await page.goto("/settings");
    await page.getByPlaceholder("e.g. Acme Workers Cooperative").fill("New Name");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    expect(capturedBody!.org_name).toBe("New Name");
    expect(capturedBody!.active_provider_id).toBe("featherless");
    expect(Array.isArray(capturedBody!.providers)).toBe(true);
  });

  test("switching provider updates model and key env defaults", async ({ page }) => {
    await page.goto("/settings");
    await page.getByLabel("OpenAI").click();
    await expect(page.getByPlaceholder("e.g. Qwen/Qwen3-32B")).toHaveValue("gpt-4o");
    await expect(page.getByPlaceholder("e.g. FEATHERLESS_API_KEY")).toHaveValue("OPENAI_API_KEY");
  });

  test("shows error when save fails", async ({ page }) => {
    await page.route("/api/v1/settings", async r => {
      if (r.request().method() === "PUT") await r.fulfill({ status: 500, json: { error: "server error" } });
      else await r.fulfill({ json: SETTINGS });
    });
    await page.goto("/settings");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText(/Failed to save settings/)).toBeVisible();
  });
});
