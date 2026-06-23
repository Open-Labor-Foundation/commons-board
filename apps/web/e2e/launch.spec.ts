import { test, expect } from "@playwright/test";
import { mockCommon } from "./helpers";

const NEW_SESSION = { session_id: "ls-1", status: "active", prompt: "What is your board's primary mission?", sections_complete: [], complete: false };

test.describe("Launch page", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommon(page);
  });

  test("shows Board Setup landing when no existing session", async ({ page }) => {
    await page.route("/api/v1/launch/current", r => r.fulfill({ json: { session: null } }));
    await page.goto("/launch");
    await expect(page.getByText("Board Setup").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Begin board setup" })).toBeVisible();
  });

  test("shows Resume option when existing session present", async ({ page }) => {
    await page.route("/api/v1/launch/current", r => r.fulfill({ json: { session: { session_id: "ls-old", status: "active", started_at: new Date().toISOString() } } }));
    await page.goto("/launch");
    await expect(page.getByText("Resume existing session")).toBeVisible();
    await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start new session" })).toBeVisible();
  });

  test("Begin board setup starts session and shows chat", async ({ page }) => {
    await page.route("/api/v1/launch/current", r => r.fulfill({ json: { session: null } }));
    await page.route("/api/v1/launch/start", r => r.fulfill({ json: NEW_SESSION }));
    await page.goto("/launch");
    await page.getByRole("button", { name: "Begin board setup" }).click();
    await expect(page.getByText("Board Setup Interview")).toBeVisible();
    await expect(page.getByText("What is your board's primary mission?")).toBeVisible();
  });

  test("Send button disabled on empty input during chat", async ({ page }) => {
    await page.route("/api/v1/launch/current", r => r.fulfill({ json: { session: null } }));
    await page.route("/api/v1/launch/start", r => r.fulfill({ json: NEW_SESSION }));
    await page.goto("/launch");
    await page.getByRole("button", { name: "Begin board setup" }).click();
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  test("user message and system reply appear in chat", async ({ page }) => {
    await page.route("/api/v1/launch/current", r => r.fulfill({ json: { session: null } }));
    await page.route("/api/v1/launch/start", r => r.fulfill({ json: NEW_SESSION }));
    await page.route("/api/v1/launch/ls-1/respond", r => r.fulfill({ json: { ...NEW_SESSION, prompt: "How many board seats?" } }));
    await page.goto("/launch");
    await page.getByRole("button", { name: "Begin board setup" }).click();
    await page.getByPlaceholder("Type your response…").fill("To empower workers.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("To empower workers.")).toBeVisible();
    await expect(page.getByText("How many board seats?")).toBeVisible();
  });

  test("complete state shows Activate board button", async ({ page }) => {
    await page.route("/api/v1/launch/current", r => r.fulfill({ json: { session: null } }));
    await page.route("/api/v1/launch/start", r => r.fulfill({ json: { ...NEW_SESSION, complete: true } }));
    await page.goto("/launch");
    await page.getByRole("button", { name: "Begin board setup" }).click();
    await expect(page.getByRole("button", { name: "Activate board" })).toBeVisible();
  });

  test("failed start shows error", async ({ page }) => {
    await page.route("/api/v1/launch/current", r => r.fulfill({ json: { session: null } }));
    await page.route("/api/v1/launch/start", r => r.fulfill({ status: 500, json: {} }));
    await page.goto("/launch");
    await page.getByRole("button", { name: "Begin board setup" }).click();
    await expect(page.getByText("Failed to start launch session.")).toBeVisible();
  });
});
