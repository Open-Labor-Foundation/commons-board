import { test, expect } from "@playwright/test";
import { mockCommon } from "./helpers";

const ISO = new Date().toISOString();
// version is a numeric string; history rows render "v{version}" so v1/v2 don't collide with latest card
const V1 = { type: "business_profile", version: "1", created_at: ISO, author: "admin" };
const V2 = { type: "business_profile", version: "2", created_at: ISO, author: "admin" };
const LATEST = { ...V2, content: { description: "We build widgets." } };

const ARTIFACT_TYPES = ["business_profile", "objective_config", "autonomy_policy", "cadence_protocol", "agent_blueprint", "collective_config"];

test.describe("Artifacts page", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommon(page);
    for (const t of ARTIFACT_TYPES) {
      await page.route(`/api/v1/artifacts/${t}/latest`, r => r.fulfill({ json: LATEST }));
      await page.route(`/api/v1/artifacts/${t}`, r => r.fulfill({ json: { artifacts: [V1, V2] } }));
    }
  });

  test("shows artifact type selector grid", async ({ page }) => {
    await page.goto("/artifacts");
    await expect(page.getByText("Business Profile").first()).toBeVisible();
    await expect(page.getByText("Autonomy Policy").first()).toBeVisible();
    await expect(page.getByText("Agent Blueprint").first()).toBeVisible();
  });

  test("loads latest artifact content for selected type", async ({ page }) => {
    await page.goto("/artifacts");
    await expect(page.getByText("We build widgets.")).toBeVisible();
  });

  test("clicking a different type loads its latest artifact", async ({ page }) => {
    await page.route("/api/v1/artifacts/objective_config/latest", r => r.fulfill({
      json: { type: "objective_config", version: "v1", created_at: ISO, content: { goal: "Grow 10x." } }
    }));
    await page.route("/api/v1/artifacts/objective_config", r => r.fulfill({ json: { artifacts: [] } }));
    await page.goto("/artifacts");
    await page.getByText("Objective Config").first().click();
    await expect(page.getByText("Grow 10x.")).toBeVisible();
  });

  test("version history is shown when multiple versions exist", async ({ page }) => {
    await page.goto("/artifacts");
    await expect(page.getByText("Version history (2)")).toBeVisible();
    await expect(page.getByText("v1")).toBeVisible();
    await expect(page.getByText("v2")).toBeVisible();
  });

  test("clicking version expands its content", async ({ page }) => {
    await page.route("/api/v1/artifacts/business_profile/1", r => r.fulfill({
      json: { type: "business_profile", version: "1", created_at: ISO, content: { description: "Expanded content." } }
    }));
    await page.goto("/artifacts");
    await page.getByText("v1").click();
    await expect(page.getByText("Expanded content.")).toBeVisible();
  });

  test("new version editor shows JSON textarea on button click", async ({ page }) => {
    await page.goto("/artifacts");
    await expect(page.getByRole("button", { name: "New version" })).toBeVisible();
    await page.getByRole("button", { name: "New version" }).click();
    await expect(page.locator("textarea").last()).toBeVisible();
  });

  test("creating a new version sends POST with correct artifact type", async ({ page }) => {
    let capturedPath: string | null = null;
    let capturedBody: Record<string, unknown> | null = null;
    await page.route("/api/v1/artifacts/business_profile", async r => {
      if (r.request().method() === "POST") {
        capturedPath = r.request().url();
        capturedBody = JSON.parse(r.request().postData() ?? "{}");
        await r.fulfill({ json: { type: "business_profile", version: "v3", created_at: ISO } });
      } else {
        await r.fulfill({ json: { artifacts: [V1, V2] } });
      }
    });
    await page.goto("/artifacts");
    await page.getByRole("button", { name: "New version" }).click();
    await page.locator("textarea").last().fill('{"key":"value"}');
    await page.getByRole("button", { name: "Save version" }).click();
    expect(capturedPath).toContain("business_profile");
    expect(capturedBody!.content).toEqual({ key: "value" });
  });

  test("shows error for invalid JSON in new version editor", async ({ page }) => {
    await page.goto("/artifacts");
    await page.getByRole("button", { name: "New version" }).click();
    await page.locator("textarea").last().fill("not valid json");
    await page.getByRole("button", { name: "Save version" }).click();
    await expect(page.getByText(/Invalid JSON/)).toBeVisible();
  });
});
