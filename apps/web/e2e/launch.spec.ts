import { test, expect } from "@playwright/test";
import { mockCommon } from "./helpers";

const SESSION_L0: { session_id: string; state: { currentSection: string; completedSections: string[]; answers: object; readyToFinalize: boolean } } = {
  session_id: "ls-1",
  state: { currentSection: "L0", completedSections: [], answers: {}, readyToFinalize: false },
};

const SESSION_L1 = {
  ...SESSION_L0,
  state: { currentSection: "L1", completedSections: ["L0"], answers: {}, readyToFinalize: false },
};

const SESSION_FINALIZE = {
  ...SESSION_L0,
  state: { currentSection: "L7", completedSections: ["L0","L1","L2","L3","L4","L5","L6","L7"], answers: {}, readyToFinalize: true },
};

test.describe("Launch (Board Setup) page", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommon(page);
  });

  test("shows Board Setup landing with Begin button", async ({ page }) => {
    await page.goto("/launch");
    await expect(page.getByRole("heading", { name: "Board Setup" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Begin board setup" })).toBeVisible();
  });

  test("Begin board setup starts session and shows L0 Agreements form", async ({ page }) => {
    await page.route("/api/v1/launch/sessions", r => r.fulfill({ json: SESSION_L0 }));
    await page.goto("/launch");
    await page.getByRole("button", { name: "Begin board setup" }).click();
    await expect(page.getByRole("heading", { name: "Agreements" })).toBeVisible();
    await expect(page.getByText("Agree & Continue")).toBeVisible();
  });

  test("failed start shows error message", async ({ page }) => {
    await page.route("/api/v1/launch/sessions", r => r.fulfill({ status: 500, json: {} }));
    await page.goto("/launch");
    await page.getByRole("button", { name: "Begin board setup" }).click();
    await expect(page.getByText(/Could not start/)).toBeVisible();
  });

  test("Agree & Continue is disabled until all checkboxes checked", async ({ page }) => {
    await page.route("/api/v1/launch/sessions", r => r.fulfill({ json: SESSION_L0 }));
    await page.goto("/launch");
    await page.getByRole("button", { name: "Begin board setup" }).click();
    const btn = page.getByRole("button", { name: "Agree & Continue" });
    await expect(btn).toBeDisabled();
    const checkboxes = page.getByRole("checkbox");
    for (let i = 0; i < 3; i++) await checkboxes.nth(i).check();
    await expect(btn).toBeEnabled();
  });

  test("submitting L0 sends payload to /sessions/:id/sections/L0", async ({ page }) => {
    let body: Record<string, unknown> | null = null;
    await page.route("/api/v1/launch/sessions", r => r.fulfill({ json: SESSION_L0 }));
    await page.route("/api/v1/launch/sessions/ls-1/sections/L0", async r => {
      body = JSON.parse(r.request().postData() ?? "{}");
      await r.fulfill({ json: { state: SESSION_L1.state } });
    });
    await page.goto("/launch");
    await page.getByRole("button", { name: "Begin board setup" }).click();
    const checkboxes = page.getByRole("checkbox");
    for (let i = 0; i < 3; i++) await checkboxes.nth(i).check();
    await page.getByRole("button", { name: "Agree & Continue" }).click();
    expect(body!.payload).toBeTruthy();
    await expect(page.getByRole("heading", { name: "Capacity" })).toBeVisible();
  });

  test("Skip sends skip:true and advances to next section", async ({ page }) => {
    let body: Record<string, unknown> | null = null;
    await page.route("/api/v1/launch/sessions", r => r.fulfill({ json: SESSION_L0 }));
    await page.route("/api/v1/launch/sessions/ls-1/sections/L0", async r => {
      body = JSON.parse(r.request().postData() ?? "{}");
      await r.fulfill({ json: { state: SESSION_L1.state } });
    });
    await page.goto("/launch");
    await page.getByRole("button", { name: "Begin board setup" }).click();
    await page.getByRole("button", { name: "Skip for now" }).click();
    expect(body!.skip).toBe(true);
    await expect(page.getByRole("heading", { name: "Capacity" })).toBeVisible();
  });

  test("L1 Capacity form has fields and continue button", async ({ page }) => {
    await page.route("/api/v1/launch/sessions", r => r.fulfill({ json: { ...SESSION_L0, state: { ...SESSION_L0.state, currentSection: "L1" } } }));
    await page.goto("/launch");
    await page.getByRole("button", { name: "Begin board setup" }).click();
    await expect(page.getByRole("heading", { name: "Capacity" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Skip" })).toBeVisible();
  });

  test("readyToFinalize shows Review form with assumptions", async ({ page }) => {
    const finalState = { currentSection: "L7", completedSections: ["L0","L1","L2","L3","L4","L5","L6","L7"], answers: {}, readyToFinalize: true };
    await page.route("/api/v1/launch/sessions", r => r.fulfill({ json: { session_id: "ls-1", state: { currentSection: "L6", completedSections: [], answers: {}, readyToFinalize: false } } }));
    await page.route("/api/v1/launch/sessions/ls-1/sections/L6", r => r.fulfill({ json: { state: finalState } }));
    await page.route("/api/v1/launch/sessions/ls-1/assumptions", r => r.fulfill({ json: { assumptions: "Your board will operate in healthcare with a $2,500/mo retainer." } }));
    await page.goto("/launch");
    await page.getByRole("button", { name: "Begin board setup" }).click();
    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page.getByRole("heading", { name: "Review Your Board Setup" })).toBeVisible();
    await expect(page.getByText("Your board will operate in healthcare")).toBeVisible();
    await expect(page.getByRole("button", { name: "Activate Board" })).toBeVisible();
  });

  test("Activate Board calls /finalize and shows success", async ({ page }) => {
    let finalized = false;
    await page.route("/api/v1/launch/sessions", r => r.fulfill({ json: { session_id: "ls-1", state: { currentSection: "L0", completedSections: [], answers: {}, readyToFinalize: false } } }));
    await page.route("/api/v1/launch/sessions/ls-1/sections/L0", r => r.fulfill({ json: { state: { currentSection: "L7", completedSections: ["L0"], answers: {}, readyToFinalize: true } } }));
    await page.route("/api/v1/launch/sessions/ls-1/assumptions", r => r.fulfill({ json: { assumptions: "Test assumptions." } }));
    await page.route("/api/v1/launch/sessions/ls-1/finalize", async r => { finalized = true; await r.fulfill({ json: { launch_blueprint_instantiated: true } }); });
    await page.goto("/launch");
    await page.getByRole("button", { name: "Begin board setup" }).click();
    await page.getByRole("button", { name: "Skip for now" }).click();
    await page.getByRole("button", { name: "Activate Board" }).click();
    expect(finalized).toBe(true);
    await expect(page.getByText("Board activated")).toBeVisible();
  });

  test("progress bar shows completed sections", async ({ page }) => {
    await page.route("/api/v1/launch/sessions", r => r.fulfill({ json: SESSION_L1 }));
    await page.goto("/launch");
    await page.getByRole("button", { name: "Begin board setup" }).click();
    await expect(page.getByText("Agreements")).toBeVisible();
    await expect(page.getByText("Capacity").first()).toBeVisible();
  });
});
