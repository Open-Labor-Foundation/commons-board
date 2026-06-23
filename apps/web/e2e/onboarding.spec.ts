import { test, expect } from "@playwright/test";
import { mockCommon } from "./helpers";

const SESSION = { session_id: "sess-1", status: "active", prompt: "Tell me about your organization.", current_section: "overview", sections_complete: [], complete: false };

test.describe("Onboarding page", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommon(page);
    await page.route("/api/v1/interview/start", r => r.fulfill({ json: SESSION }));
  });

  test("shows Onboarding Interview heading", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page.getByText("Onboarding Interview")).toBeVisible();
  });

  test("shows initial system prompt message after start", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page.getByText("Tell me about your organization.")).toBeVisible();
  });

  test("Send button is disabled when input is empty", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  test("typing a message enables Send", async ({ page }) => {
    await page.goto("/onboarding");
    await page.getByPlaceholder("Type your response…").fill("We are a worker cooperative.");
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  test("sending a message adds user bubble and system reply", async ({ page }) => {
    await page.route("/api/v1/interview/sess-1/respond", r =>
      r.fulfill({ json: { ...SESSION, prompt: "How many members do you have?" } })
    );
    await page.goto("/onboarding");
    await page.getByPlaceholder("Type your response…").fill("We are a worker cooperative.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("We are a worker cooperative.")).toBeVisible();
    await expect(page.getByText("How many members do you have?")).toBeVisible();
  });

  test("complete state shows Generate artifacts button", async ({ page }) => {
    await page.route("/api/v1/interview/start", r => r.fulfill({ json: { ...SESSION, complete: true, prompt: "All done!" } }));
    await page.goto("/onboarding");
    await expect(page.getByRole("button", { name: "Generate artifacts" })).toBeVisible();
  });

  test("confirming sends POST to /confirm and shows redirect message", async ({ page }) => {
    let confirmed = false;
    await page.route("/api/v1/interview/start", r => r.fulfill({ json: { ...SESSION, complete: true } }));
    await page.route("/api/v1/interview/sess-1/confirm", async r => { confirmed = true; await r.fulfill({ json: { artifacts: [] } }); });
    await page.goto("/onboarding");
    await page.getByRole("button", { name: "Generate artifacts" }).click();
    expect(confirmed).toBe(true);
    await expect(page.getByText("Artifacts generated.")).toBeVisible();
  });

  test("failed start shows error message", async ({ page }) => {
    await page.route("/api/v1/interview/start", r => r.fulfill({ status: 500, json: {} }));
    await page.goto("/onboarding");
    await expect(page.getByText("Failed to start interview session.")).toBeVisible();
  });
});
