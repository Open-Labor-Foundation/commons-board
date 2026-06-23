import { test, expect } from "@playwright/test";
import { mockCommon } from "./helpers";

// Correct DecisionEntry structure as expected by the governance page
const ENTRIES = [
  {
    entry_id: "ev-1",
    event: { event_name: "artifact_created", actor: "system", created_at: new Date().toISOString() },
    hash: "abc123def456789abc123def",
    prev_hash: null,
    signed: { sig: "a".repeat(64), key_id: "key-1", alg: "ed25519" },
    sequence: 1,
  },
  {
    entry_id: "ev-2",
    event: { event_name: "setting_updated", actor: "admin", created_at: new Date().toISOString() },
    hash: "xyz789qrs012xyz789qrs012",
    prev_hash: "abc123def456789abc123def",
    signed: { sig: "b".repeat(64), key_id: "key-1", alg: "ed25519" },
    sequence: 2,
  },
];

test.describe("Governance page", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommon(page);
    await page.route("/api/v1/decision-log**", r => r.fulfill({ json: { entries: ENTRIES, total: 2 } }));
  });

  test("shows Governance heading and log entries", async ({ page }) => {
    await page.goto("/governance");
    await expect(page.getByRole("heading", { name: "Governance" })).toBeVisible();
    // Badge label uses name.replace(/_/g, " ") — lowercase
    await expect(page.getByText("artifact created")).toBeVisible();
    await expect(page.getByText("setting updated")).toBeVisible();
  });

  test("shows signed badge for each signed entry", async ({ page }) => {
    await page.goto("/governance");
    // Use exact:true to match badge span text exactly (not "signed decision log" etc.)
    await expect(page.getByText("signed", { exact: true })).toHaveCount(2);
  });

  test("shows hash truncated display for each entry", async ({ page }) => {
    await page.goto("/governance");
    await expect(page.getByText(/abc123/).first()).toBeVisible();
    await expect(page.getByText(/xyz789/).first()).toBeVisible();
  });

  test("shows key_id in expanded detail on click", async ({ page }) => {
    await page.goto("/governance");
    await page.getByText("artifact created").click();
    await expect(page.getByText(/key-1/)).toBeVisible();
  });

  test("shows Next pagination button when total exceeds page size", async ({ page }) => {
    await page.route("/api/v1/decision-log**", r => r.fulfill({ json: { entries: ENTRIES, total: 25 } }));
    await page.goto("/governance");
    await expect(page.getByRole("button", { name: "Next →" })).toBeVisible();
  });

  test("empty state when no entries", async ({ page }) => {
    await page.route("/api/v1/decision-log**", r => r.fulfill({ json: { entries: [], total: 0 } }));
    await page.goto("/governance");
    await expect(page.getByText("No decisions logged yet")).toBeVisible();
  });
});
