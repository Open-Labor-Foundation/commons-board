import { test, expect } from "@playwright/test";
import { mockCommon } from "./helpers";

const STATE = { tasks: [{ task_id: "t-1", title: "Fix auth bug", type: "bug", domain: "it", status: "active", priority: 80, notes: "Needs regression test", created_at: new Date().toISOString() }, { task_id: "t-2", title: "Add caching layer", type: "feature", domain: "rnd", status: "completed", priority: 50, created_at: new Date().toISOString() }], total: 2, active: 1, completed: 1 };

test.describe("Dev Loop page", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommon(page);
    await page.route("/api/v1/devloop", r => r.fulfill({ json: STATE }));
  });

  test("shows stats and active tasks by default", async ({ page }) => {
    await page.goto("/devloop");
    await expect(page.getByText("Dev Loop")).toBeVisible();
    await expect(page.getByText("Fix auth bug")).toBeVisible();
    await expect(page.getByText("Add caching layer")).not.toBeVisible();
  });

  test("All tab shows all tasks including completed", async ({ page }) => {
    await page.goto("/devloop");
    await page.getByRole("button", { name: "All" }).click();
    await expect(page.getByText("Fix auth bug")).toBeVisible();
    await expect(page.getByText("Add caching layer")).toBeVisible();
  });

  test("Completed tab filters to completed tasks only", async ({ page }) => {
    await page.goto("/devloop");
    await page.getByRole("button", { name: "Completed" }).click();
    await expect(page.getByText("Add caching layer")).toBeVisible();
    await expect(page.getByText("Fix auth bug")).not.toBeVisible();
  });

  test("+ Task button shows form", async ({ page }) => {
    await page.goto("/devloop");
    await page.getByRole("button", { name: "+ Task" }).click();
    await expect(page.getByPlaceholder("Task title")).toBeVisible();
  });

  test("Create sends POST with correct payload", async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null;
    await page.route("/api/v1/devloop", async r => {
      if (r.request().method() === "POST") {
        capturedBody = JSON.parse(r.request().postData() ?? "{}");
        await r.fulfill({ json: { task_id: "t-3", title: "New task", status: "pending" } });
      } else {
        await r.fulfill({ json: STATE });
      }
    });
    await page.goto("/devloop");
    await page.getByRole("button", { name: "+ Task" }).click();
    await page.getByPlaceholder("Task title").fill("New dev task");
    await page.getByRole("button", { name: "Create" }).click();
    expect(capturedBody!.title).toBe("New dev task");
    expect(capturedBody!.priority).toBeDefined();
  });

  test("expanding a task with notes shows note content", async ({ page }) => {
    await page.goto("/devloop");
    await page.getByText("Fix auth bug").click();
    await expect(page.getByText("Needs regression test")).toBeVisible();
  });
});
