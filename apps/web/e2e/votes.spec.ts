import { test, expect } from "@playwright/test";
import { mockCommon } from "./helpers";

const OPEN_VOTE = { vote_id: "vote-1", title: "Approve Q3 budget", status: "open", options: ["Yes", "No"], tally: { Yes: 3, No: 1 }, quorum: 51, threshold: 51, opened_at: new Date().toISOString() };
const AMENDMENT = { amendment_id: "amend-1", title: "Update autonomy policy", artifact_type: "autonomy_policy", status: "proposed", proposed_at: new Date().toISOString() };

test.describe("Votes page", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommon(page);
    await page.route("/api/v1/votes", r => r.fulfill({ json: { votes: [OPEN_VOTE] } }));
    await page.route("/api/v1/amendments", r => r.fulfill({ json: { amendments: [AMENDMENT] } }));
  });

  test("shows votes tab by default with open vote", async ({ page }) => {
    await page.goto("/votes");
    await expect(page.getByText("Collective Governance")).toBeVisible();
    await expect(page.getByText("Approve Q3 budget")).toBeVisible();
    await expect(page.getByText("open").first()).toBeVisible();
  });

  test("shows vote tally", async ({ page }) => {
    await page.goto("/votes");
    await expect(page.getByText("Yes: 3")).toBeVisible();
    await expect(page.getByText("No: 1")).toBeVisible();
  });

  test("open vote form: Open vote sends POST with correct payload", async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null;
    await page.route("/api/v1/votes", async r => {
      if (r.request().method() === "POST") {
        capturedBody = JSON.parse(r.request().postData() ?? "{}");
        await r.fulfill({ json: { vote_id: "vote-2", title: "New vote", status: "open" } });
      } else {
        await r.fulfill({ json: { votes: [OPEN_VOTE] } });
      }
    });
    await page.goto("/votes");
    await page.getByPlaceholder("e.g. Approve Q3 budget increase").fill("New motion");
    await page.getByRole("button", { name: "Open vote" }).click();
    expect(capturedBody!.title).toBe("New motion");
    expect(Array.isArray(capturedBody!.options)).toBe(true);
    expect(capturedBody!.quorum).toBe(51);
  });

  test("Vote Yes sends POST to cast endpoint", async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null;
    await page.route("/api/v1/votes/vote-1/cast", async r => {
      capturedBody = JSON.parse(r.request().postData() ?? "{}");
      await r.fulfill({ json: { ok: true } });
    });
    await page.route("/api/v1/votes", r => r.fulfill({ json: { votes: [OPEN_VOTE] } }));
    await page.goto("/votes");
    await page.getByRole("button", { name: "Vote Yes" }).click();
    expect(capturedBody!.option).toBe("Yes");
  });

  test("Close vote sends POST to close endpoint", async ({ page }) => {
    let closeCalled = false;
    await page.route("/api/v1/votes/vote-1/close", async r => {
      closeCalled = true;
      await r.fulfill({ json: { vote_id: "vote-1", status: "closed" } });
    });
    await page.route("/api/v1/votes", r => r.fulfill({ json: { votes: [OPEN_VOTE] } }));
    await page.goto("/votes");
    await page.getByRole("button", { name: "Close" }).click();
    expect(closeCalled).toBe(true);
  });

  test("amendments tab shows proposed amendment", async ({ page }) => {
    await page.goto("/votes");
    await page.getByRole("button", { name: /Amendments/ }).click();
    await expect(page.getByText("Update autonomy policy")).toBeVisible();
    await expect(page.getByText("proposed", { exact: true })).toBeVisible();
  });

  test("propose amendment sends POST with correct payload", async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null;
    await page.route("/api/v1/amendments", async r => {
      if (r.request().method() === "POST") {
        capturedBody = JSON.parse(r.request().postData() ?? "{}");
        await r.fulfill({ json: { amendment_id: "amend-2", title: "New amendment", status: "proposed" } });
      } else {
        await r.fulfill({ json: { amendments: [AMENDMENT] } });
      }
    });
    await page.goto("/votes");
    await page.getByRole("button", { name: /Amendments/ }).click();
    await page.getByPlaceholder("Amendment title").fill("Policy update");
    await page.getByRole("button", { name: "Propose" }).click();
    expect(capturedBody!.title).toBe("Policy update");
    expect(capturedBody!.artifact_type).toBeDefined();
  });
});
