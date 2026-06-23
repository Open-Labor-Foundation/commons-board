import { test, expect } from "@playwright/test";
import { mockCommon } from "./helpers";

const PENDING = { approval_id: "appr-1", action_id: "act-1", action_type: "code_deploy", summary: "Deploy v2.0 to production", status: "pending", risk_score: 72, blast_radius: "high", created_at: new Date().toISOString() };
const APPROVED = { ...PENDING, approval_id: "appr-2", summary: "Scale workers", status: "approved", decided_by: "admin", decided_at: new Date().toISOString() };

test.describe("Approvals page", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommon(page);
    await page.route("/api/v1/approvals", r => r.fulfill({ json: { approvals: [PENDING, APPROVED] } }));
  });

  test("shows pending approvals by default", async ({ page }) => {
    await page.goto("/approvals");
    await expect(page.getByText("Deploy v2.0 to production")).toBeVisible();
    await expect(page.getByText("Scale workers")).not.toBeVisible();
  });

  test("shows risk badge for high-risk approval", async ({ page }) => {
    await page.goto("/approvals");
    await expect(page.getByText(/high \(72\)/)).toBeVisible();
  });

  test("All tab shows all approvals including approved", async ({ page }) => {
    await page.goto("/approvals");
    await page.getByRole("button", { name: /All/ }).click();
    await expect(page.getByText("Deploy v2.0 to production")).toBeVisible();
    await expect(page.getByText("Scale workers")).toBeVisible();
  });

  test("pending count shown in tab label", async ({ page }) => {
    await page.goto("/approvals");
    await expect(page.getByRole("button", { name: "Pending (1)" })).toBeVisible();
  });

  test("Approve button sends POST with approved decision", async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null;
    await page.route("/api/v1/approvals/appr-1/decide", async r => {
      capturedBody = JSON.parse(r.request().postData() ?? "{}");
      await r.fulfill({ json: { ...PENDING, status: "approved" } });
    });
    await page.route("/api/v1/approvals", r => r.fulfill({ json: { approvals: [PENDING, APPROVED] } }));
    await page.goto("/approvals");
    await page.getByRole("button", { name: "Approve" }).click();
    expect(capturedBody!.decision).toBe("approved");
  });

  test("Reject button sends POST with rejected decision", async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null;
    await page.route("/api/v1/approvals/appr-1/decide", async r => {
      capturedBody = JSON.parse(r.request().postData() ?? "{}");
      await r.fulfill({ json: { ...PENDING, status: "rejected" } });
    });
    await page.route("/api/v1/approvals", r => r.fulfill({ json: { approvals: [PENDING, APPROVED] } }));
    await page.goto("/approvals");
    await page.getByRole("button", { name: "Reject" }).click();
    expect(capturedBody!.decision).toBe("rejected");
  });

  test("expanding a row shows approval_id and action_id", async ({ page }) => {
    await page.goto("/approvals");
    await page.getByText("Deploy v2.0 to production").click();
    await expect(page.getByText("action_id: act-1")).toBeVisible();
    await expect(page.getByText("approval_id: appr-1")).toBeVisible();
  });

  test("empty state when no pending approvals", async ({ page }) => {
    await page.route("/api/v1/approvals", r => r.fulfill({ json: { approvals: [] } }));
    await page.goto("/approvals");
    await expect(page.getByText("No pending approvals.")).toBeVisible();
  });
});
